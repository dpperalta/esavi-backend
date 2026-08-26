import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Investigation } from './investigation.model';
import { ANSWER_OPTIONS, AnswerOption } from '../constants/enums.constants';
import { AppDetails } from '../types';

// Where the patient lives and whether the community reported other similar events. Tenth table with
// a direct FK to investigation to get its own spec, and the narrowest satellite specified so far:
// ten data columns, none of them NOT NULL. It is also the first satellite that leaves the case file
// and looks at the surroundings, and the first one carrying coordinates of the PATIENT'S HOME
export class InvestigationCommunity extends Model<InferAttributes<InvestigationCommunity>, InferCreationAttributes<InvestigationCommunity>> {
    // Primary key and foreign key at the same time, like investigationSource, investigationAutopsy,
    // investigationMedicalHistory, investigationClinicalEvaluation, investigationVaccinationContext,
    // investigationColdChain, investigationAdministrationError and the two notification satellites.
    // The PK already is the one to one, so the DDL declares no extra UNIQUE (esaviapp.sql:1239)
    declare investigationId: ForeignKey<Investigation['investigationId']>;

    // DECIMAL(10,7): pg hands them back as strings, which the differential helper resolves with its
    // numeric rule. SAME TYPE AS THE ONES IN investigation, NOT THE SAME MEANING: those are the
    // vaccination point, these are THE PATIENT'S HOME, and the column name says so. SPEC F28 argued
    // it did not encrypt its own because they were not the home; here they are, and they still are
    // not encrypted, because esaviCrypt yields text and these columns are numeric(10,7). The two are
    // INDEPENDENT of each other: one without the other is a valid row, there is no pair rule
    declare patientLatitude?: CreationOptional<number | string | null>;
    declare patientLongitude?: CreationOptional<number | string | null>;

    // THE KEY OF THE SIMILAR EVENT BLOCK. ONLY 'YES' OPENS IT: 'NO', 'UNKNOWN', 'NOT_APPLICABLE',
    // 'NO_ANSWER' and null close it alike, the five of them. The usual polarity of the repository,
    // like SPEC F34, F36 and F38, and NOT the inverted one of SPEC F39
    declare hadSimilarEvent?: CreationOptional<AnswerOption | null>;

    // Field 1 of the block, and THE ONLY REQUIRED ONE WHEN THE BLOCK IS OPEN. The DDL comment at
    // esaviapp.sql:1243 says "required" over five columns; this entity reads it as "the description
    // yes, the counters no", because the description is the minimum datum the block exists to
    // capture and the counters are a breakdown the informant may not have
    declare similarEventDescription?: CreationOptional<string | null>;

    // Fields 2 to 5 of the block, the four counters. OPTIONAL EVEN WITH THE BLOCK OPEN, but
    // FORBIDDEN WITH IT CLOSED, because the DDL comment spans them: they are inside the block for
    // the prohibition and outside it for the obligation. SMALLINT and not INTEGER so the 32767
    // ceiling is a declared property and not an accident, as SPEC F36 settled. ZERO IS A VALUE AND
    // NOT AN ABSENCE: "the block is closed and the count is 0" is a contradiction the create
    // rejects. THEY ARE NOT VALIDATED AGAINST EACH OTHER: the three affected* need not add up to
    // similarEventCount, because the form asks them separately
    declare similarEventCount?: CreationOptional<number | null>;
    declare affectedVaccinated?: CreationOptional<number | null>;
    declare affectedUnvaccinated?: CreationOptional<number | null>;
    declare affectedUnknown?: CreationOptional<number | null>;

    // The two free text columns OUTSIDE the block: they stay open whatever hadSimilarEvent says.
    // otherComments are the informant's remarks about the surroundings, notes are the investigator's
    // observations about the whole row. Neither the DDL nor the names carry that distinction, and
    // this entity gives neither of them a rule beyond trim() on write. NO LENGTH CAP: both are text
    declare otherComments?: CreationOptional<string | null>;
    declare notes?: CreationOptional<string | null>;

    // No activity flag is declared, and this is the tenth model of the repository without one, after
    // severeNotification, nonSevereNotification, investigationSource, investigationAutopsy,
    // investigationMedicalHistory, investigationClinicalEvaluation, investigationVaccinationContext,
    // investigationColdChain and investigationAdministrationError: the DDL does not have that column
    // (esaviapp.sql:1238-1258) and this entity does not manage its own state. Its visibility is
    // inherited from the activity flag of its investigation, and deletedAt is the only status mark
    // the row carries
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare investigation?: NonAttribute<Investigation>;
}

InvestigationCommunity.init({
    // Deliberately without defaultValue, for the same reason as investigationSource,
    // investigationAutopsy, investigationMedicalHistory, investigationClinicalEvaluation,
    // investigationVaccinationContext, investigationColdChain, investigationAdministrationError and
    // the two notification satellites: declaring gen_random_uuid() would let a create without
    // investigationId generate an orphan UUID that the FK would reject afterwards, turning a
    // readable 400 into an integrity error
    investigationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
    },
    patientLatitude: {
        type: DataTypes.DECIMAL(10, 7),
        allowNull: true,
    },
    patientLongitude: {
        type: DataTypes.DECIMAL(10, 7),
        allowNull: true,
    },
    // The ENUM takes its values from the shared constants file, never from literals written here:
    // model and validator must not be able to drift apart. A single column of the table uses it, so
    // no new constant is declared
    hadSimilarEvent: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    similarEventDescription: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    // SMALLINT and not INTEGER, for the four of them: the model type matching the column type is
    // what turns the 32767 ceiling into something the validator can replicate as a 400 instead of
    // letting Postgres raise a 500. The CHECK (... IS NULL OR ... >= 0) of the DDL is replicated
    // there too
    similarEventCount: {
        type: DataTypes.SMALLINT,
        allowNull: true,
    },
    affectedVaccinated: {
        type: DataTypes.SMALLINT,
        allowNull: true,
    },
    affectedUnvaccinated: {
        type: DataTypes.SMALLINT,
        allowNull: true,
    },
    affectedUnknown: {
        type: DataTypes.SMALLINT,
        allowNull: true,
    },
    // The three text columns carry no length, because none of them is a varchar(n) in the DDL: all
    // three are text and have no declared ceiling
    otherComments: {
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
    // TRG_investigationCommunity_setSysDetails of the loop at esaviapp.sql:1291-1306, and no trigger
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
    tableName: 'investigationCommunity',
    modelName: 'InvestigationCommunity',
    timestamps: false,
    freezeTableName: true,
});
