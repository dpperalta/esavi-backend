import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Investigation } from './investigation.model';
import { ANSWER_OPTIONS, AnswerOption } from '../constants/enums.constants';
import { AppDetails } from '../types';

// How the investigated vaccine was kept and how it travelled: whether the storage temperature was
// monitored, whether the range was breached, and in which container the dose was transported. Eighth
// table with a direct FK to investigation to get its own spec, and the first one of the series whose
// spec does not add a single line to the DDL: there is no FK to catalogItem here, so no include of a
// catalog exists anywhere in this entity
export class InvestigationColdChain extends Model<InferAttributes<InvestigationColdChain>, InferCreationAttributes<InvestigationColdChain>> {
    // Primary key and foreign key at the same time, like investigationSource, investigationAutopsy,
    // investigationMedicalHistory, investigationClinicalEvaluation, investigationVaccinationContext
    // and the two notification satellites: the row does not identify itself, it is identified by the
    // investigation whose cold chain it describes. The PK already is the one to one, so the DDL
    // declares no extra UNIQUE (esaviapp.sql:1176)
    declare investigationId: ForeignKey<Investigation['investigationId']>;

    // THE KEY OF THE STORAGE BLOCK, and a boolean and not an answerOption because that is what the
    // column is (esaviapp.sql:1177). Three states and not five: ONLY true OPENS THE BLOCK, while
    // false - "it was not monitored" - and null - "it is not known" - close it alike, because under
    // neither of them is there a measurement to derive a deviation from
    declare storageTemperatureMonitored?: CreationOptional<boolean | null>;

    // The single field of the storage block. false IS A VALUE AND NOT AN ABSENCE: "it was monitored
    // and there was no deviation" is the most frequent finding of the form, so no candidate of the
    // update service may ever enter under a truthiness check
    declare storageRangeDeviation?: CreationOptional<boolean | null>;

    // The six independent columns of the storage section. NONE of them belongs to the block: a
    // procedure, the four fridge findings and the free text are observed without a thermometer, so
    // making them depend on the monitoring flag would tie them to something they do not need.
    // storageDiluentNotUsable is an answer of the form and NOT a reference to the diluent registered
    // in the notification: it resolves against no row of diluentCatalog nor notificationDiluent
    declare storageProcedureFollowed?: CreationOptional<AnswerOption | null>;
    declare storageOtherObjectPresent?: CreationOptional<AnswerOption | null>;
    declare storagePartiallyReconstitutedVaccine?: CreationOptional<AnswerOption | null>;
    declare storageVaccineNotUsable?: CreationOptional<AnswerOption | null>;
    declare storageDiluentNotUsable?: CreationOptional<AnswerOption | null>;
    declare storageKeyFindings?: CreationOptional<string | null>;

    // THE TWO SIDES OF THE MUTUAL EXCLUSION. They describe the same fact - in which container the
    // vaccine travelled - and cannot both be 'YES'. transportUsedThermos is the side WITH
    // precedence: it wins the inherited tie, and only that one
    declare transportUsedThermos?: CreationOptional<AnswerOption | null>;

    // THREE COLUMNS WHOSE NAME LIES ABOUT THEIR CONTENT, and it is a finding of the spec, not an
    // error of it. They carry Thermos in the name, but the form in force unifies both containers:
    // they ask "was it set in / returned in the container" and "what type of container was it",
    // where the container may be a thermos OR A COLD PACK. The three apply to whichever container
    // was used, so THEY BELONG TO NO CONDITIONAL BLOCK: they stay open even when no container was
    // declared, and neither flag forbids nor forces them. The DDL order reinforces the wrong reading
    // - transportUsedColdPack is declared after them, at esaviapp.sql:1188, as if they hung from the
    // thermos of :1185 - and that order must be ignored. The names are not changed: the DDL is
    // authoritative and there are rows loaded against it
    declare transportSetInThermos?: CreationOptional<AnswerOption | null>;
    declare transportReturnedInThermos?: CreationOptional<AnswerOption | null>;

    // The side WITHOUT precedence of the mutual exclusion
    declare transportUsedColdPack?: CreationOptional<AnswerOption | null>;

    // Free text with no catalog behind it, exactly as the DDL declares it. It also applies to the
    // container and not to the thermos. Only trim() on write
    declare transportTypeThermo?: CreationOptional<string | null>;

    declare transportKeyFindings?: CreationOptional<string | null>;
    declare notes?: CreationOptional<string | null>;

    // No activity flag is declared, and this is the eighth model of the repository without one,
    // after severeNotification, nonSevereNotification, investigationSource, investigationAutopsy,
    // investigationMedicalHistory, investigationClinicalEvaluation and
    // investigationVaccinationContext: the DDL does not have that column (esaviapp.sql:1175-1198)
    // and this entity does not manage its own state. Its visibility is inherited from the activity
    // flag of its investigation, and deletedAt is the only status mark the row carries
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare investigation?: NonAttribute<Investigation>;
}

InvestigationColdChain.init({
    // Deliberately without defaultValue, for the same reason as investigationSource,
    // investigationAutopsy, investigationMedicalHistory, investigationClinicalEvaluation,
    // investigationVaccinationContext and the two notification satellites: declaring
    // gen_random_uuid() would let a create without investigationId generate an orphan UUID that the
    // FK would reject afterwards, turning a readable 400 into an integrity error
    investigationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
    },
    // BOOLEAN and not ENUM, for both of them: the model has to match the column, and translating
    // here to answerOption would invent a type the table does not have and force a decision about
    // which boolean 'UNKNOWN', 'NOT_APPLICABLE' and 'NO_ANSWER' map to - three values a boolean
    // cannot represent and that would be lost on write
    storageTemperatureMonitored: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    storageRangeDeviation: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    // The ENUM takes its values from the shared constants file, never from literals written here:
    // model and validator must not be able to drift apart
    storageProcedureFollowed: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    storageOtherObjectPresent: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    storagePartiallyReconstitutedVaccine: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    storageVaccineNotUsable: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    storageDiluentNotUsable: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    storageKeyFindings: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    transportUsedThermos: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    transportSetInThermos: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    transportReturnedInThermos: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    transportUsedColdPack: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    // The length is explicit so an overlong text fails in Sequelize and not in Postgres. It is the
    // only varchar(n) of the table; the other three free text columns carry no limit in the DDL and
    // stay TEXT
    transportTypeThermo: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    transportKeyFindings: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('current_timestamp')
    },
    // Written by the application: this table carries only the generic
    // TRG_investigationColdChain_setSysDetails of the loop at esaviapp.sql:1290-1305, and no trigger
    // touches updatedAt
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
    tableName: 'investigationColdChain',
    modelName: 'InvestigationColdChain',
    timestamps: false,
    freezeTableName: true,
});
