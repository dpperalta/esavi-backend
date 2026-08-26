
import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { AppUser } from './appUser.model';

/**
 * appSession — esaviapp.sql:337-357. One row per login, holding the hash of the refresh token
 * that renews it.
 *
 * Two departures from the rest of the schema, both deliberate and both declared in SPEC F42 §3.1:
 *
 *   - **No `isActive`.** It is the only table in the auth block without it. A session's life is
 *     expressed by `revokedAt`: null means live. That is why this entity has no `005A`/`005B`,
 *     never goes through `setEntityActiveStatusService` and has no dual `002A`/`002B` listing.
 *     A session is not reactivated — a new one is opened.
 *   - **No `absoluteExpiresAt`.** The ceiling of the sliding window is derived as
 *     `startedAt + REFRESH_ABSOLUTE_MAX_IN` on every renewal, which is what makes `startedAt`
 *     immutable: it is the anchor of that arithmetic and must never be rewritten.
 */
export class AppSession extends Model<InferAttributes<AppSession>, InferCreationAttributes<AppSession>> {
    declare sessionId: CreationOptional<string>;
    declare userId: ForeignKey<AppUser['userId']>;
    declare refreshTokenHash?: CreationOptional<string | null>;
    declare ipAddress?: CreationOptional<string | null>;
    declare userAgent?: CreationOptional<string | null>;
    declare startedAt: CreationOptional<Date>;
    declare expiresAt?: CreationOptional<Date | null>;
    declare revokedAt?: CreationOptional<Date | null>;
    declare revokedReason?: CreationOptional<string | null>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;
    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<object | null>;

    declare user?: NonAttribute<AppUser>;
}

AppSession.init({
    sessionId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    // SHA-256 of the secret half of the refresh token, 64 hexadecimal characters. The token in
    // clear text exists only in the response of ESAVI-SESSION-001 and never reaches this column.
    refreshTokenHash: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    // `inet` in the DDL. Sequelize has no `inet` type, and Postgres casts the text on the way in,
    // so STRING is the declaration that works without a custom type. Trace only: never validated.
    ipAddress: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    userAgent: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    // Anchor of the absolute ceiling. Written once by the database default and never updated.
    startedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('current_timestamp')
    },
    // Sliding: every renewal pushes it to min(now + REFRESH_TOKEN_EXPIRES_IN,
    // startedAt + REFRESH_ABSOLUTE_MAX_IN). CK_appSession_dates requires it to stay above startedAt.
    expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    revokedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    // One of SESSION_REVOKE_REASONS in src/constants/session.constants.ts. The column is free
    // text in the DDL, so that list is the only thing keeping the values from drifting.
    revokedReason: {
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
    deletedAt: {
        type: DataTypes.DATE
    },
    sysDetails: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    // Handled as an array, like every other entity: [...currentAppDetails, newEntry]. The DDL
    // default is '{}' here as it is in the other 44 tables.
    appDetails: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
    }
}, {
    sequelize,
    tableName: 'appSession',
    modelName: 'AppSession',
    timestamps: false,
    freezeTableName: true,
});
