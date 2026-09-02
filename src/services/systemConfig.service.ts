import { Op, Transaction, WhereOptions } from 'sequelize';
import { sequelize } from '../database/connection';
import { AppUser, SystemConfig, SystemConfigHistory } from '../models';
import {
    AppError,
    buildDifferentialUpdate,
    buildTextSearchConditions,
    decryptSystemConfigValue,
    encryptSystemConfigValue,
    esaviDecrypt,
    getMessage,
    isValidSystemConfigValue,
    toConstantCase
} from '../helpers';
import {
    AppDetails,
    AuthUser,
    CreateSystemConfigInput,
    SystemConfigListFilters,
    SystemConfigValueType
} from '../types';
import { SYSTEM_CONFIG_DEFAULTS } from '../data/systemConfig.defaults';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The default of the two columns the DDL resolves on its own. They are applied here and not left to
// the database because the uniqueness of (code, scope) has to be checked against the value that will
// actually be stored: a create with no scope collides with an existing GLOBAL one, and asking the
// database about `undefined` would never find it
const DEFAULT_SCOPE = 'GLOBAL';
const DEFAULT_VALUE_TYPE: SystemConfigValueType = 'json';

// The nullable text column of the entity, trimmed on write. undefined and null both land as null on
// create: an absent field and an explicitly emptied one mean the same thing when the row does not
// exist yet
const trimOrNull = (value?: string | null): string | null =>
    value !== undefined && value !== null ? value.trim() : null;

// SQL NULL and the JSON null are two different values, and the column tells them apart: `value` is
// jsonb NOT NULL, which forbids the first one and stores the second one without complaint. Sequelize
// maps the null of JavaScript to SQL NULL, so writing it straight would be a 500 —
// "notNull Violation: SystemConfig.value cannot be null" — over what §3.5 declares a legitimate value
// under valueType 'json'.
// The literal is what says "the JSON scalar null", and it reads back as the null of JavaScript, so
// the 003 answers value: null and the diff of the 004 compares null against null and does not write.
// It is applied to every jsonb NOT NULL column of the two tables: `value` and `newValue`.
// previousValue does not need it — that column is nullable, and there SQL NULL is exactly what the
// first row of a configuration means
const toStorableValue = (value: unknown): unknown =>
    value === null ? sequelize.literal("'null'::jsonb") : value;

// sysDetails is internal trigger state and never leaves the service. The reads drop it through
// `attributes: { exclude }`, which a create cannot use, so the returned instance is flattened and
// stripped here — the response shape of §3.7 is the fifteen columns minus this one
const stripSysDetails = (config: SystemConfig): Record<string, unknown> => {
    const plain = config.get({ plain: true }) as Record<string, unknown>;
    delete plain.sysDetails;
    return plain;
}

// The masking of §3.7, and the only difference between the four read operations. It is `value: null`
// and never '***': the row carries isEncrypted: true, so the client tells "encrypted and not visible
// to you" from "empty" without a sentinel — and a '***' resent in a PUT, which is exactly what a form
// repainting what it read does, would be stored as the literal value and would destroy the secret
// with a 200
const maskEncryptedValue = (row: Record<string, unknown>): Record<string, unknown> => {
    if( row.isEncrypted ) {
        row.value = null;
    }
    return row;
}

// Shared by both listings, which take exactly the same five filters. scope compares for equality
// against the value normalized with toConstantCase — the column stores the normalized form, so asking
// about the raw one would never match; valueType compares for equality and the validator has already
// restricted it to the five literals of the CHECK. name and code are the canonical parameters
// (SPEC F52), joined with Op.or; search is the legacy alias and already covered both columns before
// this spec, so it keeps doing so when name/code do not arrive — the caller does not always know
// whether they remember the text a human reads or the key a program resolves
const buildSystemConfigWhere = (filters: SystemConfigListFilters): WhereOptions => {
    const where: Record<string, unknown> = {};
    if( filters.scope ) {
        where.scope = toConstantCase(filters.scope.trim());
    }
    if( filters.valueType ) {
        where.valueType = filters.valueType;
    }
    const textConditions = [
        ...buildTextSearchConditions(filters.name ?? filters.search, ['name']),
        ...buildTextSearchConditions(filters.code ?? filters.search, ['code'])
    ];
    if( textConditions.length > 0 ) {
        where[Op.or as unknown as string] = textConditions;
    }
    return where;
}

// The two listings mask ALWAYS, whatever the role of whoever asks — SUPERADMIN included. A listing is
// a set read, and it would drag every secret at once into any cache, browser history or screenshot.
// Whoever needs the value asks for it through its 003 or its 006, one at a time and leaving the trace
// in the log of that operation
const maskEncryptedRows = (result: { count: number; rows: SystemConfig[] }) => ({
    count: result.count,
    rows: result.rows.map(row => maskEncryptedValue(row.get({ plain: true }) as Record<string, unknown>))
});

// How the nullable text columns enter `candidates`: null empties the column and undefined means the
// key never travelled, which are two different intents. The comparison is against undefined and never
// a truthiness test, or an empty string would be silently dropped
const textCandidate = (value?: string | null): string | null | undefined =>
    value !== undefined ? (value?.trim() ?? null) : undefined;

// The answer of the 004, changed or not. §3.7 puts it under the masking rules of the 003, and the 004
// is SUPERADMIN-only — the single role that reads a decrypted secret — so the resulting value goes
// back in plain text. It is handed in rather than read off the instance because the column holds the
// ciphertext and decrypting it again here would be a second round trip through esaviDecrypt for a
// value the caller already has
const shapeUpdatedSystemConfig = (config: SystemConfig, plainValue: unknown): Record<string, unknown> => {
    const plain = stripSysDetails(config);
    plain.value = plainValue;
    return plain;
}

// The cross validation of §3.5, shared by the 001, the 004 and the 008. It lives in the service and
// not in a validator because the 004 needs the stored valueType when the body does not carry one,
// and an express-validator chain does not query the database
const assertValueMatchesType = (value: unknown, valueType: SystemConfigValueType, lang: string, code: string): void => {
    if( !isValidSystemConfigValue(value, valueType) ) {
        throw new AppError(
            getMessage('systemConfig.valueTypeMismatch', lang, { valueType }),
            400,
            `SYSCONF_${ code }_VALUE_TYPE_MISMATCH`
        );
    }
}

// The uniqueness of UQ_systemConfig_code_scope, composite and not global: the same code may repeat
// under a different scope. It does NOT filter by isActive — the constraint of the DDL knows nothing
// about isActive, and filtering here would turn a 409 into a 500 when the database rejected the
// INSERT with a 23505. Both halves arrive already normalized
const assertCodeScopeIsFree = async (
    code: string,
    scope: string,
    lang: string,
    transaction?: Transaction
): Promise<void> => {
    const existingConfig = await SystemConfig.findOne({
        where: { code, scope },
        attributes: ['systemConfigId'],
        transaction
    });
    if( existingConfig ) {
        throw new AppError(getMessage('systemConfig.codeExists', lang, { code, scope }), 409, 'SYSCONF_001_CODE_EXISTS');
    }
}

// ESAVI-SYSCONF-001 - Create System Config Service
// The seven steps of §3.5, in this order: normalize, validate the value against the type, check the
// uniqueness of the pair, encrypt if the row declares itself a secret, write the row, write its
// history, and do the last two inside one transaction
const createSystemConfigService = async (data: CreateSystemConfigInput, authUser: AuthUser | undefined, lang: string) => {
    // Normalized before the uniqueness check, with the same function the 006 uses to resolve a code
    // arriving through the URL: the constraint of the DDL is over the stored value, so asking about
    // the raw one would let ESAVI_MAX_UPLOAD in twice.
    // The scope default is resolved BEFORE normalizing, or GLOBAL and Global would coexist as two
    // different scopes
    const code = toConstantCase(data.code.trim());
    const scope = toConstantCase(( data.scope ?? DEFAULT_SCOPE ).trim());
    const valueType: SystemConfigValueType = data.valueType ?? DEFAULT_VALUE_TYPE;

    assertValueMatchesType(data.value, valueType, lang, '001');
    await assertCodeScopeIsFree(code, scope, lang);

    const isEncrypted = data.isEncrypted === true;
    // The column is jsonb NOT NULL and esaviCrypt returns text, so the ciphertext travels wrapped as
    // { "enc": "<ciphertext>" }. The `enc` key is what tells an encrypted value from any
    // valueType 'string' by looking at the database
    const storedValue = isEncrypted ? encryptSystemConfigValue(data.value) : data.value;

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-SYSCONF-001',
        detail: 'System configuration created by service'
    };

    // One transaction for the two writes, by §11: they are dependent, and a history row orphaned of
    // its configuration would be a change nobody can trace back to what it changed
    const transaction = await sequelize.transaction();
    try {
        const newSystemConfig = await SystemConfig.create({
            code,
            // Only trimmed, never toTitleCase: toTitleCase would turn 'Tamaño máximo de carga' into
            // 'Tamaño Máximo De Carga'. The asymmetry with code is deliberate — the code is an
            // identifier the application mints, the name is text the user writes
            name: data.name.trim(),
            description: trimOrNull(data.description),
            value: toStorableValue(storedValue),
            valueType,
            scope,
            isEncrypted,
            isEditable: data.isEditable !== undefined ? data.isEditable : true,
            isActive: data.isActive !== undefined ? data.isActive : true,
            appDetails: [newEntry]
        }, { transaction });

        // The first history row of a configuration: previousValue is null because there was nothing
        // before, and newValue holds what was stored — encrypted if the row is, so the two columns
        // always share the regime of the configuration they belong to
        await SystemConfigHistory.create({
            systemConfigId: newSystemConfig.systemConfigId,
            previousValue: null,
            newValue: toStorableValue(storedValue),
            changedByUserId: authUser?.userId ?? null,
            // The field that breaks the symmetry: it travels in the body without being a column of
            // systemConfig, and its only destination is this row. Optional in the 001
            changeReason: trimOrNull(data.changeReason),
            appDetails: [newEntry]
        }, { transaction });

        await transaction.commit();

        const createdConfig = stripSysDetails(newSystemConfig);
        // The instance a create returns holds whatever was handed to it, and for a JSON null that is
        // the Literal object rather than the value it stands for. What went into the column is known
        // here without a round trip, so it is written back over it instead of reloading the row
        createdConfig.value = storedValue;

        // Masked even though only a SUPERADMIN gets here: the answer of a create is not the door to
        // read secrets, and the 003 is
        return maskEncryptedValue(createdConfig);
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// ESAVI-SYSCONF-002A - Get Active System Configs Service
const getActiveSystemConfigsService = async (
    filters: SystemConfigListFilters,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const systemConfigs = await SystemConfig.findAndCountAll({
        where: {
            ...buildSystemConfigWhere(filters),
            isActive: true
        },
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        // scope first and code second: a configuration screen reads by area, and inside an area by
        // the key. It is also the order a human scanning ESAVI_* keys expects
        order: [['scope', 'ASC'], ['code', 'ASC']],
        limit,
        offset
    });
    return maskEncryptedRows(systemConfigs);
}

// ESAVI-SYSCONF-002B - Get All System Configs Service (including inactive) - For Admin
const getAllSystemConfigsService = async (
    filters: SystemConfigListFilters,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    // The twin of 002A without isActive in the where, with the same three filters, the same order and
    // the SAME masking: this listing is ADMIN and it does not decrypt either. Being able to see the
    // deactivated rows is not the same as being able to read a secret, and the only role that reads
    // one is SUPERADMIN, through the 003 or the 006
    const systemConfigs = await SystemConfig.findAndCountAll({
        where: buildSystemConfigWhere(filters),
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        order: [['scope', 'ASC'], ['code', 'ASC']],
        limit,
        offset
    });
    return maskEncryptedRows(systemConfigs);
}

// The single read shape of the 003 and the 006: same row, same rules, two different doors.
// It is where the ONLY decryption of an ordinary read happens, and it is SUPERADMIN-only — canDecrypt
// carries that decision from the controller, where the predicate lives. For USER and ADMIN an
// encrypted row comes out masked exactly as it does in the two listings
const shapeSingleSystemConfig = (config: SystemConfig, canDecrypt: boolean): Record<string, unknown> => {
    const plain = config.get({ plain: true }) as Record<string, unknown>;
    if( !plain.isEncrypted ) {
        return plain;
    }
    if( !canDecrypt ) {
        return maskEncryptedValue(plain);
    }
    plain.value = decryptSystemConfigValue(plain.value);
    return plain;
}

// ESAVI-SYSCONF-003 - Get System Config by ID Service
const getSystemConfigByIdService = async (
    id: string,
    lang: string,
    includeInactive: boolean = false,
    canDecrypt: boolean = false
) => {
    const whereClause = includeInactive ? { systemConfigId: id } : { systemConfigId: id, isActive: true };
    // No include of the history: reading the change log is its own operation, the 007, and it is
    // SUPERADMIN-only while this one is USER
    const systemConfig = await SystemConfig.findOne({
        where: whereClause,
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] }
    });
    if( !systemConfig ) {
        // An inactive row answers 404 unless canViewInactive is true, and that predicate is
        // SUPERADMIN-only: an ADMIN gets the same 404 as a USER even though the 002B does list the
        // inactive ones to them. It is the deliberate asymmetry healthFacility, diagnosticTerm,
        // vaccineWhodrug and diluentCatalog already carry
        throw new AppError(getMessage('systemConfig.notFound', lang), 404, 'SYSCONF_003_NOT_FOUND');
    }
    return shapeSingleSystemConfig(systemConfig, canDecrypt);
}

// ESAVI-SYSCONF-006 - Get System Config by (code, scope) Service
// The operation the table exists for. A CRUD by UUID is no use to whoever reads configuration: the
// application knows the name of its parameter, never its identifier — which is also why this is not a
// query param over the 002A, that would answer { count, rows } for a single-entity read and could not
// tell "does not exist", a 404, from "empty list", a 200
const getSystemConfigByCodeService = async (
    rawCode: string,
    rawScope: string | undefined,
    lang: string,
    includeInactive: boolean = false,
    canDecrypt: boolean = false
) => {
    // BOTH normalized before searching, with the same function the 001 writes them with. Without this
    // the endpoint that exists to read by name would answer differently depending on the case the URL
    // was typed in, and GET /code/esavi_max_upload would miss the row GET /code/ESAVI_MAX_UPLOAD finds.
    // The scope default is resolved BEFORE normalizing, exactly as in the 001
    const code = toConstantCase(rawCode.trim());
    const scope = toConstantCase(( rawScope ?? DEFAULT_SCOPE ).trim());

    const whereClause = includeInactive
        ? { code, scope }
        : { code, scope, isActive: true };

    const systemConfig = await SystemConfig.findOne({
        where: whereClause,
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] }
    });
    if( !systemConfig ) {
        // The message names the pair, not just the code: the uniqueness is composite, and a 404
        // saying only the code would read as "this parameter does not exist" when what does not exist
        // is that parameter in that scope
        throw new AppError(getMessage('systemConfig.codeNotFound', lang, { code, scope }), 404, 'SYSCONF_006_NOT_FOUND');
    }
    // The rules of inactive rows and of decryption are EXACTLY those of the 003 — same answer, another
    // door in — so the shaping is the same function and not a copy of it
    return shapeSingleSystemConfig(systemConfig, canDecrypt);
}

// ESAVI-SYSCONF-004 - Update System Config Service
// THE ORDER OF THE SEVEN STEPS OF §3.5 IS THE OPERATION, not a way of writing it down. Two guards run
// BEFORE the diff and are independent of it — a protected row is a 409 even when the body changes
// nothing, and a valueType incompatible with the resulting value is a 400 even when that value is the
// one already stored — because both describe the regime of the row rather than the content of the
// request.
// No uniqueness is checked here, and that is not an oversight: both halves of
// UQ_systemConfig_code_scope are immutable, so the pair cannot collide in an update
const updateSystemConfigService = async (
    id: string,
    data: Partial<CreateSystemConfigInput>,
    authUser: AuthUser | undefined,
    lang: string
) => {
    const { userId } = authUser || {};

    // 1. Existence
    const systemConfig = await SystemConfig.findByPk(id);
    if( !systemConfig ) {
        throw new AppError(getMessage('systemConfig.notFound', lang), 404, 'SYSCONF_004_NOT_FOUND');
    }

    // 2. A protected row rejects the PUT before anything else is looked at. It is a 409 and not a
    // 403: 403 is the status of the role middleware and means "you may not", when here the problem is
    // the row and not who asks — the same SUPERADMIN getting this 409 can edit any other one.
    // Letting an empty PUT through because the diff would have come out empty anyway would make the
    // same endpoint answer 200 or 409 depending on the body, and a client could not tell "this row is
    // editable" from "I changed nothing"
    if( systemConfig.isEditable === false ) {
        throw new AppError(getMessage('systemConfig.notEditable', lang, { id }), 409, 'SYSCONF_004_NOT_EDITABLE');
    }

    const isEncrypted = systemConfig.isEncrypted === true;

    // Captured before any update touches the instance: this is what goes into previousValue, exactly
    // as the column held it — encrypted if the row is
    const previousStoredValue = systemConfig.value;

    // 4. The stored value comes back to plain text BEFORE `stored` is built, so the diff compares
    // plain text against plain text. Comparing ciphertext would work only while the IV of esaviCrypt
    // stays fixed, and the day it turns random every PUT would look like a change and would write a
    // history row per screen opening — which is exactly the noise this table exists to avoid
    const storedPlainValue = isEncrypted
        ? decryptSystemConfigValue(systemConfig.value)
        : systemConfig.value;

    // 3. Cross validation against the RESULTING valueType — the one in the body if it travels, the
    // stored one if it does not. Validating against the body alone would let a PUT that only changes
    // valueType to 'number' over a value that is an array through, and the row would be left lying
    // about its own type
    const resultingValueType = ( data.valueType ?? systemConfig.valueType ) as SystemConfigValueType;
    const resultingValue = data.value !== undefined ? data.value : storedPlainValue;
    assertValueMatchesType(resultingValue, resultingValueType, lang, '004');

    const currentAppDetails = Array.isArray(systemConfig.appDetails) ? systemConfig.appDetails : [];

    // 5. The whole row, which is the precondition of the helper — a narrowed `attributes` would read
    // back undefined for what it left out and every comparison would count as a change — with the
    // value already in plain text
    const stored = systemConfig.get({ plain: true }) as Record<string, unknown>;
    stored.value = storedPlainValue;

    // 6. Five candidates over the eight data columns: code, scope and isEncrypted are immutable and
    // are ignored without a 400 — that is what §11 asks for immutable fields, and it keeps a client
    // resending the whole GET ficha from being punished for sending what it never meant to change —
    // isActive is governed by 005A and 005B, and changeReason is not a column of this table at all
    const objectToUpdate = buildDifferentialUpdate(stored, {
        // Only trimmed, never toTitleCase — see the create
        name: data.name ? data.name.trim() : undefined,
        description: textCandidate(data.description),
        // Plain text on both sides; the helper compares jsonb with JSON.stringify, so the service
        // does not compare objects by hand
        value: data.value !== undefined ? data.value : undefined,
        valueType: data.valueType ?? undefined,
        // Compared against undefined and NEVER under `if( data.isEditable )`, which would drop the
        // false and make it impossible to protect a row again
        isEditable: data.isEditable !== undefined ? data.isEditable : undefined
    });

    // Nothing changed: no UPDATE, no updatedAt, no appDetails entry, no sysDetails event and no
    // history row. The row goes back as it is, with a 200
    if( Object.keys(objectToUpdate).length === 0 ) {
        return shapeUpdatedSystemConfig(systemConfig, storedPlainValue);
    }

    // THE CENTRAL RULE OF THE 004: history is written if and only if 'value' is among the keys the
    // helper returned. Not because the key `value` travelled in the body — a form resending the whole
    // ficha would then generate a history row per screen opening, and a log full of entries recording
    // nothing is not traceability, it is noise hiding the real changes
    const valueChanged = Object.prototype.hasOwnProperty.call(objectToUpdate, 'value');

    // changeReason is required when the value really CHANGES, and the check lives here rather than in
    // the validator for the same reason the history write does: the trigger is the appearance of
    // 'value' in the output of the helper, never the presence of the key in the body. A client
    // resending the whole ficha of its own GET always carries value, so a validator rule would make
    // the 200-without-change of §5 unreachable for this entity
    const changeReason = textCandidate(data.changeReason) ?? null;
    if( valueChanged && !changeReason ) {
        throw new AppError(
            getMessage('systemConfig.changeReasonRequired', lang),
            400,
            'SYSCONF_004_CHANGE_REASON_REQUIRED'
        );
    }

    // 7. The encryption happens now, AFTER the diff, over the key the helper returned
    const newStoredValue = valueChanged && isEncrypted
        ? encryptSystemConfigValue(objectToUpdate.value)
        : objectToUpdate.value;
    if( valueChanged ) {
        objectToUpdate.value = toStorableValue(newStoredValue);
    }

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: userId || 'undefined',
        method: 'ESAVI-SYSCONF-004',
        detail: 'System configuration updated by service'
    };

    const writeUpdate = async (transaction?: Transaction) => systemConfig.update({
        ...objectToUpdate,
        updatedAt: new Date(),
        appDetails: [
            ...currentAppDetails,
            newEntry
        ]
    }, { returning: true, transaction });

    let updatedSystemConfig = systemConfig;
    if( valueChanged ) {
        // Two dependent writes, so one transaction — the same reason as in the 001
        const transaction = await sequelize.transaction();
        try {
            updatedSystemConfig = await writeUpdate(transaction);
            await SystemConfigHistory.create({
                systemConfigId: id,
                // What was there, EXACTLY as it was stored — encrypted if it was — and what is left,
                // under the same regime. The two columns of a history row always share the regime of
                // the configuration they belong to
                previousValue: previousStoredValue ?? null,
                newValue: toStorableValue(newStoredValue),
                changedByUserId: userId ?? null,
                // Guaranteed present by the guard above: without it the history records who and when
                // but never why, which is half of what it is for
                changeReason,
                appDetails: [newEntry]
            }, { transaction });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    } else {
        // A single write needs no transaction, as everywhere else in the repository
        updatedSystemConfig = await writeUpdate();
    }

    // The resulting plain value: what the body brought when it changed, what was stored when it did
    // not. `newStoredValue` is the pre-encryption value in both cases, so no second decryption is
    // needed to answer
    return shapeUpdatedSystemConfig(
        updatedSystemConfig,
        valueChanged ? resultingValue : storedPlainValue
    );
}

// ESAVI-SYSCONF-005A / ESAVI-SYSCONF-005B - Set System Config Activation Service
// Not a differential update: these are writes with an intention of their own. They record a state
// fact, so they go through setEntityActiveStatusService and never through buildDifferentialUpdate.
//
// NEITHER OF THE TWO WRITES HISTORY. The columns of systemConfigHistory are previousValue/newValue:
// the table records changes of value, and deactivating changes none. The trace of the activation
// already lives in appDetails and in sysDetails.auditTrail.
//
// NEITHER OF THE TWO LOOKS AT isEditable. That flag protects the content of the row, not its
// existence, so deactivating a protected configuration works — it is the 004 that answers 409.
//
// The where filters by the primary key alone. The incoming foreign key from systemConfigHistory is
// not checked: this is a logical delete, the ON DELETE RESTRICT never fires, and the history of a
// withdrawn configuration stays readable through the 007
const setSystemConfigActivationService = async (
    id: string,
    authUser: AuthUser | undefined,
    lang: string,
    isActive: boolean = true
) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        const systemConfig = await setEntityActiveStatusService({
            model: SystemConfig,
            where: { systemConfigId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('systemConfig.notFound', lang),
            notFoundCode: `SYSCONF_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`systemConfig.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `SYSCONF_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                // Only the computed operation code, with no _ACTIVATION stuck behind it
                method: `ESAVI-SYSCONF-${ op }`,
                detail: `SystemConfig ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return systemConfig;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// ESAVI-SYSCONF-007 - Get System Config History Service
// The read of a table that has no meaning outside its configuration, which is why it hangs off the
// parent and systemConfigHistory gets no route, no abbreviation and no CRUD of its own
const getSystemConfigHistoryService = async (
    id: string,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET,
    lang: string
) => {
    // The existence of the PARENT is checked BEFORE querying the child, and that order is the whole
    // point: a non-existent id answering { count: 0, rows: [] } would read as "this configuration
    // never changed", which is a false statement about something that does not exist.
    // isActive is not filtered — the endpoint is SUPERADMIN-only, and the history of a withdrawn
    // configuration stays readable by design
    const systemConfig = await SystemConfig.findByPk(id, {
        attributes: ['systemConfigId', 'isEncrypted']
    });
    if( !systemConfig ) {
        throw new AppError(getMessage('systemConfig.notFound', lang), 404, 'SYSCONF_007_NOT_FOUND');
    }

    const history = await SystemConfigHistory.findAndCountAll({
        where: { systemConfigId: id },
        attributes: { exclude: ['sysDetails', 'appDetails', 'updatedAt', 'deletedAt', 'changedByUserId'] },
        include: [{
            model: AppUser,
            as: 'changedByUser',
            // Only the two columns an audit screen needs. The rest of appUser is PII this view has no
            // business carrying, and a bare UUID would force a second request per row to find out who
            // it was — and whoever reads a history reads several rows in a row
            attributes: ['userId', 'displayName'],
            required: false
        }],
        // Exactly the order of IX_systemConfigHistory_config, and not by coincidence
        order: [['createdAt', 'DESC']],
        limit,
        offset
    });

    const isEncrypted = systemConfig.isEncrypted === true;

    return {
        count: history.count,
        rows: history.rows.map(row => {
            const plain = row.get({ plain: true }) as Record<string, unknown>;
            const author = plain.changedByUser as { userId: string; displayName: string } | null;
            return {
                systemConfigHistoryId: plain.systemConfigHistoryId,
                systemConfigId: plain.systemConfigId,
                // Both values are DECRYPTED here, and only here among the reads of a set, because this
                // endpoint is already SUPERADMIN-only. previousValue is null on the first row of a
                // configuration and decryptSystemConfigValue returns it untouched
                previousValue: isEncrypted ? decryptSystemConfigValue(plain.previousValue) : plain.previousValue,
                newValue: isEncrypted ? decryptSystemConfigValue(plain.newValue) : plain.newValue,
                changeReason: plain.changeReason,
                createdAt: plain.createdAt,
                // null when the foreign key was left null by the ON DELETE SET NULL of the DDL: the
                // history of a deleted user keeps its rows and loses only the author.
                // changedByUserId is NOT repeated outside this nested object
                changedByUser: author
                    ? { userId: author.userId, displayName: esaviDecrypt(author.displayName) }
                    : null
            };
        })
    };
}

// ESAVI-SYSCONF-008 - Sync System Config Defaults Service
// Idempotent seeding of the initial configurations. ONLY-INSERT by design: it creates what is missing
// and touches nothing that already exists — not the value, not the name, not the state.
//
// AN INACTIVE ROW COUNTS AS EXISTING and is not reactivated: somebody deactivated it on purpose, and
// a POST /sync cannot undo a deliberate decision of somebody else. That is also why the existence
// query does not filter by isActive.
//
// ONE TRANSACTION, ALL OR NOTHING. An entry of the catalogue with a badly declared valueType aborts
// the whole seeding with a 400 instead of leaving half a configuration created: a half-seeded set is
// a state nobody knows how to resume from, and the catalogue is a code file whose error is fixed and
// deployed again
const syncSystemConfigDefaultsService = async (authUser: AuthUser | undefined, lang: string) => {
    const created: { code: string; scope: string }[] = [];
    const skipped: { code: string; scope: string }[] = [];

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-SYSCONF-008',
        detail: 'System configuration seeded by sync service'
    };

    const transaction = await sequelize.transaction();
    try {
        for( const entry of SYSTEM_CONFIG_DEFAULTS ) {
            const code = toConstantCase(entry.code.trim());
            const scope = toConstantCase(( entry.scope ?? DEFAULT_SCOPE ).trim());

            // The same cross validation as the 001 and the 004, and it runs on every entry — including
            // the ones that will be skipped: a catalogue that declares an impossible value is broken
            // whether or not that row happens to exist in this database already, and the deploy that
            // fixes it should fail the same way everywhere
            assertValueMatchesType(entry.value, entry.valueType, lang, '008');

            const existingConfig = await SystemConfig.findOne({
                where: { code, scope },
                attributes: ['systemConfigId'],
                transaction
            });
            if( existingConfig ) {
                skipped.push({ code, scope });
                continue;
            }

            const isEncrypted = entry.isEncrypted === true;
            const storedValue = isEncrypted ? encryptSystemConfigValue(entry.value) : entry.value;

            const newSystemConfig = await SystemConfig.create({
                code,
                name: entry.name.trim(),
                description: trimOrNull(entry.description),
                value: toStorableValue(storedValue),
                valueType: entry.valueType,
                scope,
                isEncrypted,
                isEditable: entry.isEditable !== undefined ? entry.isEditable : true,
                isActive: true,
                appDetails: [newEntry]
            }, { transaction });

            // Every row the sync creates leaves its history row, exactly as the 001 does: a
            // configuration that appeared without a trace of who put it there would be the one gap in
            // the audit this table exists for
            await SystemConfigHistory.create({
                systemConfigId: newSystemConfig.systemConfigId,
                previousValue: null,
                newValue: toStorableValue(storedValue),
                changedByUserId: authUser?.userId ?? null,
                changeReason: 'Seeded by ESAVI-SYSCONF-008',
                appDetails: [newEntry]
            }, { transaction });

            created.push({ code, scope });
        }

        await transaction.commit();
        // Without the full rows: what matters about a sync is what was missing, not the content of
        // what was already there
        return { created, skipped };
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createSystemConfigService,
    getActiveSystemConfigsService,
    getAllSystemConfigsService,
    getSystemConfigByIdService,
    getSystemConfigByCodeService,
    updateSystemConfigService,
    setSystemConfigActivationService,
    getSystemConfigHistoryService,
    syncSystemConfigDefaultsService
}
