import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../database/connection';
import { AppDetails } from '../types';

// The raw mirror of the full WHODrug standard, downloaded from the UMC regional-drugs API.
// Third model of the repository with no foreign key at all — neither outgoing nor declared here —
// and therefore the third one without an associations file, after vaccineWhodrug and diagnosticTerm.
// Vaccines exist here too (the mirror is integral, J07 included) but nobody reads them from this
// table: the curated vaccineWhodrug is what notificationVaccine and investigationVaccineAdministered
// reference.
export class WhodrugProduct extends Model<InferAttributes<WhodrugProduct>, InferCreationAttributes<WhodrugProduct>> {
    declare whodrugProductId: CreationOptional<string>;

    // The API returns no row identifier: this is the only key the sync can rely on to avoid
    // duplicating the table on every run. SHA-256 over the seven fields that identify a presentation
    declare rowHash: string;

    // Repeats across rows by design: the same medicine is reached through its presentation in
    // each country, holder, form and strength
    declare drugCode: string;

    declare drugName: string;

    // All the ATCs of the medicine, replicated in every one of its rows, delimited by ';' at both
    // ends (;J07AN01;L03AX;). Level-of-medicine data kept on a level-of-presentation table so the
    // vaccine exclusion of the 006 stays a single per-row predicate
    declare drugAtcs?: CreationOptional<string | null>;

    declare medicinalProductId?: CreationOptional<string | null>;

    // A single ATC per row: the flattening explodes the list. Same plural name as vaccineWhodrug
    declare atcs?: CreationOptional<string | null>;

    declare ingredient?: CreationOptional<string | null>;
    declare ingredientTranslations?: CreationOptional<string | null>;
    declare languageCode?: CreationOptional<string | null>;
    declare iso3Code?: CreationOptional<string | null>;
    declare countryMedicinalProductId?: CreationOptional<string | null>;
    declare maHolders?: CreationOptional<string | null>;
    declare maHoldersMedicinalProductId?: CreationOptional<string | null>;
    declare form?: CreationOptional<string | null>;
    declare formMedicinalProductId?: CreationOptional<string | null>;
    declare strength?: CreationOptional<string | null>;
    declare strengthMedicinalProductId?: CreationOptional<string | null>;

    // Binary, not ternary like its vaccineWhodrug counterpart: the source flattening always resolves
    // this value, so a third "unknown" state has nothing to represent here
    declare isGeneric: CreationOptional<boolean>;

    declare isPreferred: CreationOptional<boolean>;

    // Derived and of exclusive write from the sync (007): ingredientTranslations (drugName),
    // deduplicated and joined by '; '. No client ever sends it
    declare optionName: string;

    // optionName lowercased and stripped of diacritics, calculated in Node at import time. The
    // only column the search (006) touches
    declare optionNameSearch: string;

    // Sealed at insert and never touched by the differential update: it carries downloadedAt, which
    // would otherwise differ on every sync and defeat the diff contract
    declare metadata?: CreationOptional<object | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;
}

WhodrugProduct.init({
    whodrugProductId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    rowHash: {
        type: DataTypes.CHAR(64),
        allowNull: false,
    },
    drugCode: {
        type: DataTypes.STRING(50),
        allowNull: false,
    },
    drugName: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    drugAtcs: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    medicinalProductId: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    atcs: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    ingredient: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    ingredientTranslations: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    languageCode: {
        type: DataTypes.STRING(10),
        allowNull: true,
    },
    iso3Code: {
        type: DataTypes.STRING(3),
        allowNull: true,
    },
    countryMedicinalProductId: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    maHolders: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    maHoldersMedicinalProductId: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    form: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    formMedicinalProductId: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    strength: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    strengthMedicinalProductId: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    isGeneric: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    isPreferred: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    optionName: {
        type: DataTypes.STRING(500),
        allowNull: false,
    },
    optionNameSearch: {
        type: DataTypes.STRING(500),
        allowNull: false,
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
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
    tableName: 'whodrugProduct',
    modelName: 'WhodrugProduct',
    timestamps: false,
    freezeTableName: true,
});
