import { Op, Transaction, WhereOptions } from 'sequelize';
import { sequelize } from '../database/connection';
import { SystemConfig, SystemConfigHistory } from '../models';
import {
    AppError,
    decryptSystemConfigValue,
    encryptSystemConfigValue,
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

// Shared by both listings, which take exactly the same three filters. scope compares for equality
// against the value normalized with toConstantCase — the column stores the normalized form, so asking
// about the raw one would never match; valueType compares for equality and the validator has already
// restricted it to the five literals of the CHECK; search is an Op.iLike over name AND code joined by
// Op.or, because a parameter is looked up either by the text a human reads or by the key a program
// resolves, and the caller does not always know which one they remember
const buildSystemConfigWhere = (filters: SystemConfigListFilters): WhereOptions => {
    const where: Record<string, unknown> = {};
    if( filters.scope ) {
        where.scope = toConstantCase(filters.scope.trim());
    }
    if( filters.valueType ) {
        where.valueType = filters.valueType;
    }
    if( filters.search ) {
        const term = `%${ filters.search.trim() }%`;
        where[Op.or as unknown as string] = [
            { name: { [Op.iLike]: term } },
            { code: { [Op.iLike]: term } }
        ];
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

export {
    createSystemConfigService,
    getActiveSystemConfigsService,
    getAllSystemConfigsService,
    getSystemConfigByIdService,
    getSystemConfigByCodeService
}
