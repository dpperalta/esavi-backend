import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../database/connection';
import { AppDetails } from '../types';

// The controlled vocabulary the suspected vaccine of an ESAVI is identified with: the WHODrug
// dictionary of vaccines. Second model of the repository with no foreign key at all — neither
// outgoing nor declared here — and therefore the second one without an associations file: the two
// incoming references (notificationVaccine and investigationVaccineAdministered) belong to the side
// that owns the key and will be declared by their own specs.
// The table is vaccineWhodrug but the HTTP route is /api/whodrug-vaccines: the API surface reads
// "vaccines of the WHODrug dictionary", which is the order a consumer searches for them in, while
// the file, the model and the service keep the table name because there they must match the DDL
export class VaccineWhodrug extends Model<InferAttributes<VaccineWhodrug>, InferCreationAttributes<VaccineWhodrug>> {
    declare vaccineWhodrugId: CreationOptional<string>;

    // The unique key of the table, global and over a single column. Nullable on purpose: under a
    // Postgres UNIQUE, N rows with NULL coexist, so a manual entry without externalId never
    // collides with the key space of the dictionary
    declare externalId?: CreationOptional<number | null>;

    // No uniqueness at all: the WHODrug file repeats drugCode by design — the same vaccine is
    // reached through its presentation in each country. The API requires it as data anyway,
    // because an entry without a code cannot be crossed against anything
    declare drugCode?: CreationOptional<string | null>;

    declare drugRecNo?: CreationOptional<string | null>;
    declare drugRecNoSeq?: CreationOptional<string | null>;
    declare drugName: string;
    declare language?: CreationOptional<string | null>;
    declare medicinalProductId?: CreationOptional<string | null>;

    // The file header is atcs and the values are ATC codes (J07AN). The DDL column was renamed
    // rather than papered over with an alias, which would have left the wrong name in the model,
    // in the types and in every HTTP response forever
    declare atcs?: CreationOptional<string | null>;

    declare icd11?: CreationOptional<string | null>;
    declare icd11Term?: CreationOptional<string | null>;
    declare abbreviation?: CreationOptional<string | null>;
    declare ingredient?: CreationOptional<string | null>;
    declare ingredientTranslation?: CreationOptional<string | null>;

    // Distinct from language and of a different width: they are two separate headers of the source
    // dump, so the DDL reproduces the origin and this model exposes them as two independent fields
    declare languageCode?: CreationOptional<string | null>;

    declare iso3Code?: CreationOptional<string | null>;
    declare countryMedicinalProductId?: CreationOptional<string | null>;
    declare maHolders?: CreationOptional<string | null>;
    declare maHoldersMedicinalProductId?: CreationOptional<string | null>;
    declare form?: CreationOptional<string | null>;
    declare formTranslations?: CreationOptional<string | null>;
    declare formMedicinalProductId?: CreationOptional<string | null>;
    declare strength?: CreationOptional<string | null>;
    declare strengthMedicinalProductId?: CreationOptional<string | null>;
    declare noDose?: CreationOptional<string | null>;

    // Free text, not a foreign key to diluentCatalog despite that table existing: the column is
    // text in the DDL and it is treated as text
    declare diluent?: CreationOptional<string | null>;

    // Three states. The DDL gave it no DEFAULT, so null means "unknown" and is information
    // distinct from false
    declare isGeneric?: CreationOptional<boolean | null>;

    // NOT NULL DEFAULT false: never null, in any layer
    declare isPreferred?: CreationOptional<boolean>;

    declare notes?: CreationOptional<string | null>;

    // Read-only from this entity's CRUD. It exists because the column exists and reads return it,
    // but no operation of SPEC F18 writes it: the bulk import of SPEC F19 stamps the provenance of
    // the load at insert time and nobody else touches it
    declare metadata?: CreationOptional<object | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;
}

VaccineWhodrug.init({
    vaccineWhodrugId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    externalId: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    drugCode: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    drugRecNo: {
        type: DataTypes.STRING(50),
        allowNull: true,
    },
    drugRecNoSeq: {
        type: DataTypes.STRING(50),
        allowNull: true,
    },
    drugName: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    language: {
        type: DataTypes.STRING(10),
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
    icd11: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    icd11Term: {
        type: DataTypes.STRING(500),
        allowNull: true,
    },
    abbreviation: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    ingredient: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    ingredientTranslation: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    languageCode: {
        type: DataTypes.STRING(100),
        allowNull: true,
    },
    iso3Code: {
        type: DataTypes.STRING(250),
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
    formTranslations: {
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
    noDose: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    diluent: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    // No defaultValue on purpose: the DDL gave the column none, and adding one here would collapse
    // the third state and lose "unknown" on the first import
    isGeneric: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    isPreferred: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true,
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
    tableName: 'vaccineWhodrug',
    modelName: 'VaccineWhodrug',
    timestamps: false,
    freezeTableName: true,
});
