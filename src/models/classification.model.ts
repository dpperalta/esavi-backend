import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { EsaviCase } from './esaviCase.model';
import { CatalogItem } from './catalogItem.model';
import { AppDetails } from '../types';

export class Classification extends Model<InferAttributes<Classification>, InferCreationAttributes<Classification>> {
    declare classificationId: CreationOptional<string>;
    declare caseId: ForeignKey<EsaviCase['caseId']>;
    declare ageUnitItemId?: ForeignKey<CatalogItem['catalogItemId']> | null;

    // age and ageUnitItemId are derived from patient.birthDate and esaviCase.eventDate by the
    // service; the client input only survives as the fallback for when either date is missing
    declare age?: CreationOptional<number | null>;
    declare firstConsultationDate?: CreationOptional<string | null>;

    // The nine severity flags are tri-state: null means "not informed", which is not false
    declare isSeriousEvent?: CreationOptional<boolean | null>;
    declare causedDeath?: CreationOptional<boolean | null>;
    declare causedDisability?: CreationOptional<boolean | null>;
    declare causedCongenitalAnomaly?: CreationOptional<boolean | null>;
    declare causedFetalDeath?: CreationOptional<boolean | null>;
    declare causedLifeThreatening?: CreationOptional<boolean | null>;
    declare causedHospitalization?: CreationOptional<boolean | null>;
    declare causedAbortion?: CreationOptional<boolean | null>;
    declare causedOtherCondition?: CreationOptional<boolean | null>;

    declare otherSeriousConditionDescription?: CreationOptional<string | null>;
    declare notes?: CreationOptional<string | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare case?: NonAttribute<EsaviCase>;
    declare ageUnit?: NonAttribute<CatalogItem>;
}

Classification.init({
    classificationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    caseId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    // SMALLINT and not INTEGER, mirroring the DDL. No branch of the calculation can overflow it:
    // days never pass 30, months never pass 11, and years never reach 32 767
    age: {
        type: DataTypes.SMALLINT,
        allowNull: true,
    },
    ageUnitItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    firstConsultationDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    // No defaultValue on any of the nine booleans: defaultValue false would collapse the
    // tri-state into two states and erase the difference between "no" and "not informed"
    isSeriousEvent: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    causedDeath: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    causedDisability: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    causedCongenitalAnomaly: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    causedFetalDeath: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    causedLifeThreatening: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    causedHospitalization: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    causedAbortion: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    causedOtherCondition: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    otherSeriousConditionDescription: {
        type: DataTypes.TEXT,
        allowNull: true,
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
    tableName: 'classification',
    modelName: 'Classification',
    timestamps: false,
    freezeTableName: true,
});
