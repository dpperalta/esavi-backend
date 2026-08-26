import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { EsaviCase } from './esaviCase.model';
import { CatalogItem } from './catalogItem.model';
import { AppDetails } from '../types';

export class FinalClassification extends Model<InferAttributes<FinalClassification>, InferCreationAttributes<FinalClassification>> {
    declare finalClassificationId: CreationOptional<string>;
    declare caseId: ForeignKey<EsaviCase['caseId']>;

    // The three slots of the WHO/PAHO precedence order. They all point at the same catalogType
    // (finalClassificationImportance) and cannot repeat a value between them; the rule lives in
    // the service, because no CHECK in the DDL can express uniqueness across columns of one row
    declare importanceAItemId?: ForeignKey<CatalogItem['catalogItemId']> | null;
    declare importanceBItemId?: ForeignKey<CatalogItem['catalogItemId']> | null;
    declare importanceCItemId?: ForeignKey<CatalogItem['catalogItemId']> | null;

    // The eight causality flags are tri-state: null means "not evaluated", which is not false.
    // Blocks A, B and C say what was marked; block D says nothing could be evaluated at all
    declare aIsRelatedToVaccineProduct?: CreationOptional<boolean | null>;
    declare aIsRelatedToQualityDeviation?: CreationOptional<boolean | null>;
    declare aIsRelatedToProgrammaticError?: CreationOptional<boolean | null>;
    declare aIsRelatedToStress?: CreationOptional<boolean | null>;
    declare bIsConsistentTemporalRelation?: CreationOptional<boolean | null>;
    declare bHasDeterminantFactor?: CreationOptional<boolean | null>;
    declare cHasCoincidentCause?: CreationOptional<boolean | null>;
    declare dIsUnclassifiable?: CreationOptional<boolean | null>;

    declare notes?: CreationOptional<string | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare case?: NonAttribute<EsaviCase>;
    declare importanceA?: NonAttribute<CatalogItem>;
    declare importanceB?: NonAttribute<CatalogItem>;
    declare importanceC?: NonAttribute<CatalogItem>;
}

FinalClassification.init({
    // The PK is its own column and not the FK, unlike the ten satellites of investigation: the
    // client never supplies it, so it keeps the gen_random_uuid() default of the DDL
    finalClassificationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    caseId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    importanceAItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    importanceBItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    importanceCItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    // No defaultValue on any of the eight booleans: defaultValue false would collapse the
    // tri-state into two states and erase the difference between "evaluated and ruled out"
    // and "not evaluated" — which is exactly what block D's prohibition needs to tell apart
    aIsRelatedToVaccineProduct: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    aIsRelatedToQualityDeviation: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    aIsRelatedToProgrammaticError: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    aIsRelatedToStress: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    bIsConsistentTemporalRelation: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    bHasDeterminantFactor: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    cHasCoincidentCause: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    dIsUnclassifiable: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    // text in the DDL, with no declared ceiling: no length here and no .isLength() in the validator
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
    tableName: 'finalClassification',
    modelName: 'FinalClassification',
    timestamps: false,
    freezeTableName: true,
});
