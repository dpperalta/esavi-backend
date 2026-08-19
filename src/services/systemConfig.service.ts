import { Transaction } from 'sequelize';
import { sequelize } from '../database/connection';
import { SystemConfig, SystemConfigHistory } from '../models';
import {
    AppError,
    encryptSystemConfigValue,
    getMessage,
    isValidSystemConfigValue,
    toConstantCase
} from '../helpers';
import { AppDetails, AuthUser, CreateSystemConfigInput, SystemConfigValueType } from '../types';

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

export {
    createSystemConfigService
}
