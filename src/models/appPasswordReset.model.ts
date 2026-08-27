import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { AppUser } from './appUser.model';

/**
 * appPasswordReset — esaviapp.sql:358-379. One row per self-service password reset request,
 * holding the hash of the single-use token that authorises writing a new password.
 *
 * Two departures from the rest of the schema, both deliberate and both declared in SPEC F43 §3.1:
 *
 *   - **No `isActive`.** It is the second table of the auth block without it, after `appSession`
 *     and for the same reason: the row's life is expressed with timestamps, not with a switch.
 *     A reset request is not reactivated — another one is asked for. That is why this entity has
 *     no `005A`/`005B`, never goes through `setEntityActiveStatusService` and has no dual
 *     `002A`/`002B` listing.
 *   - **`usedAt` and `invalidatedAt` are two columns, not one.** A consumed token and a token
 *     superseded by a later request are different states behind the same observable fact — the
 *     link no longer works — and only the first one is suspicious: presenting an already consumed
 *     token is the signal that someone is replaying a link that circulated. That distinction is
 *     what triggers the defensive invalidation of step 4 of ESAVI-AUTH-007 (SPEC F43 §3.5).
 */
export class AppPasswordReset extends Model<InferAttributes<AppPasswordReset>, InferCreationAttributes<AppPasswordReset>> {
    declare resetId: CreationOptional<string>;
    declare userId: ForeignKey<AppUser['userId']>;
    declare tokenHash: string;
    declare expiresAt: Date;
    declare usedAt?: CreationOptional<Date | null>;
    declare invalidatedAt?: CreationOptional<Date | null>;
    declare invalidatedReason?: CreationOptional<string | null>;
    declare requestedIp?: CreationOptional<string | null>;
    declare requestedUserAgent?: CreationOptional<string | null>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;
    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<object | null>;

    declare user?: NonAttribute<AppUser>;
}

AppPasswordReset.init({
    // First half of the composite token `<resetId>.<secret>`: it is what locates the row by
    // primary key, so resolving a token never scans the table looking for a hash.
    resetId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    // SHA-256 of the secret half of the token, 64 hexadecimal characters. The token in clear text
    // exists once, travels in the email, and never reaches this column, appDetails or any log.
    tokenHash: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    // createdAt + ESAVI_PASSWORD_RESET_EXPIRES_MINUTES, computed in the application.
    // CK_appPasswordReset_dates requires it to stay above createdAt.
    expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
    },
    // Consumption mark. NULL is "not used yet"; a non-null value on an incoming token is replay.
    usedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    // Invalidation without consumption: the request was superseded, the password changed, or a
    // replay was detected on a sibling row.
    invalidatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    // One of PASSWORD_RESET_INVALIDATION_REASONS. The column is free text in the DDL, so that
    // list is the only thing keeping the values from drifting.
    invalidatedReason: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    // `inet` in the DDL. Sequelize has no `inet` type, and Postgres casts the text on the way in,
    // so STRING is the declaration that works without a custom type. Trace only: never compared
    // when the token is consumed.
    requestedIp: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    // Trace only, like requestedIp.
    requestedUserAgent: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('current_timestamp')
    },
    updatedAt: {
        type: DataTypes.DATE
    },
    // Carried by the cross-cutting convention of the 46 tables. No operation of SPEC F43 writes
    // it: the filters of PWDRESET-006 and -007 include it so a future logical purge needs no
    // change to them.
    deletedAt: {
        type: DataTypes.DATE
    },
    sysDetails: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    // Handled as an array, like every other entity: [...currentAppDetails, newEntry]. The DDL
    // default is '{}' here as it is in the other 45 tables.
    appDetails: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
    }
}, {
    sequelize,
    tableName: 'appPasswordReset',
    modelName: 'AppPasswordReset',
    timestamps: false,
    freezeTableName: true,
});
