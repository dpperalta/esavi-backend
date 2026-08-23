import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Investigation } from './investigation.model';
import { AppDetails } from '../types';

// Who investigated the case: name, institution, contact and notes, one row per person. Third
// satellite of investigation and the first of them that is a collection with state of its own —
// investigationSource and investigationAutopsy are one to one over a shared primary key, this one
// has its own PK and a plain NOT NULL foreign key (esaviapp.sql:995-1011)
export class InvestigationTeamMember extends Model<InferAttributes<InvestigationTeamMember>, InferCreationAttributes<InvestigationTeamMember>> {
    declare investigationTeamMemberId: CreationOptional<string>;
    declare investigationId: ForeignKey<Investigation['investigationId']>;

    // The only NOT NULL data column of the table (esaviapp.sql:998). Free text, never a reference to
    // appUser: this entity has no FK to that table and does not deduplicate people. Written through
    // toTitleCase, and not encrypted — the investigating team is health personnel acting in a public
    // capacity, not the patient the system protects
    declare fullName: string;

    // Stored exactly as the investigator typed it, only trimmed. Deliberately without toTitleCase,
    // against the general rule: the institution names of this domain are acronyms — MINSAL, ISP,
    // OPS — and title casing them would corrupt a value that is printed on an official document
    declare institutionName?: CreationOptional<string | null>;

    // citext in the DDL (esaviapp.sql:1000), so the comparison in the database already ignores case.
    // The application lowercases it on write anyway, so the differential update compares stable text
    // and does not invent a difference between Ana@x.cl and ana@x.cl. Not encrypted: esaviCrypt is
    // deterministic with a fixed IV, and encrypting would leave the citext property inert
    declare email?: CreationOptional<string | null>;

    declare phone?: CreationOptional<string | null>;

    // Assigned by TRG_investigationTeamMember_setSortOrder (BEFORE INSERT only, esaviapp.sql:1317)
    // and protected by the partial unique index over (investigationId, sortOrder) WHERE deletedAt IS
    // NULL. Declared without defaultValue on purpose: a defaultValue of 0 would make the INSERT send
    // an explicit 0, which is exactly the value the trigger reads as "assign it yourself". The
    // create omits the column through CREATE_FIELDS instead, and nothing but ESAVI-INVTEAM-005B
    // ever writes it
    declare sortOrder?: CreationOptional<number>;

    declare notes?: CreationOptional<string | null>;

    // The first satellite of investigation that has this column (esaviapp.sql:1004), and the reason
    // the seven canonical operations come back here: retiring a person from the investigating team
    // is a fact of the domain with its own author and motive. No cascade from investigation or from
    // esaviCase ever writes it — the parent contributes visibility through the include, never state
    declare isActive?: CreationOptional<boolean>;

    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare investigation?: NonAttribute<Investigation>;
}

InvestigationTeamMember.init({
    // With defaultValue, unlike investigationSource and investigationAutopsy: there the PK was the
    // FK and the client supplied it, here the row identifies itself and the database mints the id
    investigationTeamMemberId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    investigationId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    // The lengths are explicit so an overlong text fails in Sequelize and not in Postgres
    fullName: {
        type: DataTypes.STRING(250),
        allowNull: false,
    },
    institutionName: {
        type: DataTypes.STRING(500),
        allowNull: true,
    },
    // Declared without a length: the column is citext, which has none
    email: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    phone: {
        type: DataTypes.STRING(50),
        allowNull: true,
    },
    sortOrder: {
        type: DataTypes.SMALLINT,
        allowNull: false,
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('current_timestamp')
    },
    // Written by the application: this table carries no TRG_investigationTeamMember_setUpdatedAt —
    // the generic loop of the DDL drops it and never creates it, in any of the 45 tables
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
    appDetails: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
    }
}, {
    sequelize,
    tableName: 'investigationTeamMember',
    modelName: 'InvestigationTeamMember',
    timestamps: false,
    freezeTableName: true,
});
