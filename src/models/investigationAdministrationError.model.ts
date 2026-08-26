import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Investigation } from './investigation.model';
import { ANSWER_OPTIONS, AnswerOption } from '../constants/enums.constants';
import { AppDetails } from '../types';

// What went wrong in the act of administering the vaccine: which syringes it was applied with, how
// the vial was reconstituted and which concrete errors happened in prescription, preparation,
// handling and application. It is the counterpart of investigationColdChain - that one asks how the
// product was kept before being applied, this one asks what happened while applying it. Ninth table
// with a direct FK to investigation to get its own spec, and the second one of the series whose spec
// does not add a single line to the DDL: there is no FK to catalogItem here either, so no include of
// a catalog exists anywhere in this entity. Twenty six data columns, and not one of them NOT NULL
export class InvestigationAdministrationError extends Model<InferAttributes<InvestigationAdministrationError>, InferCreationAttributes<InvestigationAdministrationError>> {
    // Primary key and foreign key at the same time, like investigationSource, investigationAutopsy,
    // investigationMedicalHistory, investigationClinicalEvaluation, investigationVaccinationContext,
    // investigationColdChain and the two notification satellites: the row does not identify itself,
    // it is identified by the investigation whose administration error it describes. The PK already
    // is the one to one, so the DDL declares no extra UNIQUE (esaviapp.sql:1201)
    declare investigationId: ForeignKey<Investigation['investigationId']>;

    // THE KEY OF THE SYRINGE BLOCK, AND THE FIRST OF THE REPOSITORY THAT OPENS WITH THE NEGATIVE
    // ANSWER. Only 'NO' opens the block - the single comment of the DDL (esaviapp.sql:1203) says
    // "If answer is 'No', then the following fields are required" - while 'YES', 'UNKNOWN',
    // 'NOT_APPLICABLE', 'NO_ANSWER' and null close it, the five alike. The form logic is direct: if
    // auto disable syringes were used there is nothing else to ask, and if it is not known or does
    // not apply there is no type to declare. Every previous block of the repository - F34, F36, F38 -
    // opened with the affirmation, so a condition written as === 'YES' here is inverted and passes
    // every case of the block but one
    declare usedAutoDisableSyringes?: CreationOptional<AnswerOption | null>;

    // THE FOUR SYRINGE TYPES OF THE BLOCK, boolean and not answerOption because that is what the
    // columns are (esaviapp.sql:1204-1207). They live inside a block whose own key is an
    // answerOption, and the model does not translate between the two types: mapping them would force
    // a decision about which boolean 'UNKNOWN', 'NOT_APPLICABLE' and 'NO_ANSWER' correspond to -
    // three values a boolean cannot represent and that would be lost on write. With the block open
    // AT LEAST ONE of the four must result true, which is the first minimum rule of the repository.
    // false IS A VALUE AND NOT AN ABSENCE: it says "syringes were used, but not glass ones", a
    // legitimate answer of the form, so no candidate may ever enter under a truthiness check
    declare usedGlassSyringes?: CreationOptional<boolean | null>;
    declare usedDisposableSyringes?: CreationOptional<boolean | null>;
    declare usedRecycledDisposableSyringes?: CreationOptional<boolean | null>;

    // The fourth type, AND THE KEY OF THE NESTED BLOCK: only when it results true is
    // otherSyringesDescription allowed
    declare usedOtherSyringes?: CreationOptional<boolean | null>;

    // THE FIRST NESTED BLOCK OF THE REPOSITORY. It belongs to the outer block - the comment of
    // esaviapp.sql:1203 reaches down to :1208 - AND to the nested one, so it carries two chained
    // conditions and one failing is enough for it to be forbidden. The nested condition is written
    // in no line of the DDL: it comes from the form. The description IS NEVER REQUIRED: marking
    // "other syringes" without saying which is a valid record
    declare otherSyringesDescription?: CreationOptional<string | null>;

    // OUTSIDE THE BLOCK, and the DDL says so by placing it after the "End above fields" of :1209.
    // Free text always open: it is stored even when no syringe type was declared at all
    declare syringesKeyFindings?: CreationOptional<string | null>;

    // The five reconstitution columns, INDEPENDENT of each other and of everything else. They are
    // NOT mutually exclusive, even though the first four describe practices that in the field are:
    // the form asks them separately and the record must be allowed exactly as it arrives.
    // Introducing the exclusion would also require deciding the precedence, and that is not this
    // entity's decision to make
    declare reconstitutionUsedSameSyringe?: CreationOptional<AnswerOption | null>;
    declare reconstitutionUsedSameSyringeDifferentVaccine?: CreationOptional<AnswerOption | null>;
    declare reconstitutionUsedDifferentSyringeSameVial?: CreationOptional<AnswerOption | null>;
    declare reconstitutionUsedDifferentSyringeDifferentVaccine?: CreationOptional<AnswerOption | null>;
    declare reconstitutionFollowedManufacturerRecommendation?: CreationOptional<AnswerOption | null>;
    declare reconstitutionKeyFindings?: CreationOptional<string | null>;

    // THE SIX had* / *Notes PAIRS ARE TWELVE INDEPENDENT COLUMNS, AND THIS IS A DECISION AND NOT AN
    // OMISSION. No note hangs from its flag: a 'NO' accompanied by the reason, an 'UNKNOWN' with the
    // explanation of why it is not known, or a loose comment are all valid records. They look like
    // six conditional blocks and they are not: hanging them would silently erase notes already
    // stored with the flag at 'NO'. Six acceptance criteria of the spec protect this
    declare hadPrescriptionError?: CreationOptional<AnswerOption | null>;
    declare prescriptionErrorNotes?: CreationOptional<string | null>;
    declare hadContaminatedVaccine?: CreationOptional<AnswerOption | null>;
    declare contaminatedVaccineNotes?: CreationOptional<string | null>;
    declare hadAbnormalVaccineConditions?: CreationOptional<AnswerOption | null>;
    declare abnormalConditionsNotes?: CreationOptional<string | null>;
    declare hadPreparationError?: CreationOptional<AnswerOption | null>;
    declare preparationErrorNotes?: CreationOptional<string | null>;
    declare hadHandlingError?: CreationOptional<AnswerOption | null>;
    declare handlingErrorNotes?: CreationOptional<string | null>;
    declare hadImproperAdministration?: CreationOptional<AnswerOption | null>;
    declare improperAdministrationNotes?: CreationOptional<string | null>;

    // The observations of the WHOLE row, and the only one of the five columns carrying Notes in the
    // name that is not the note of a concrete error. The DDL does not write that distinction and the
    // name does not suggest it
    declare notes?: CreationOptional<string | null>;

    // No activity flag is declared, and this is the ninth model of the repository without one, after
    // severeNotification, nonSevereNotification, investigationSource, investigationAutopsy,
    // investigationMedicalHistory, investigationClinicalEvaluation, investigationVaccinationContext
    // and investigationColdChain: the DDL does not have that column (esaviapp.sql:1200-1236) and
    // this entity does not manage its own state. Its visibility is inherited from the activity flag
    // of its investigation, and deletedAt is the only status mark the row carries
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare investigation?: NonAttribute<Investigation>;
}

InvestigationAdministrationError.init({
    // Deliberately without defaultValue, for the same reason as investigationSource,
    // investigationAutopsy, investigationMedicalHistory, investigationClinicalEvaluation,
    // investigationVaccinationContext, investigationColdChain and the two notification satellites:
    // declaring gen_random_uuid() would let a create without investigationId generate an orphan UUID
    // that the FK would reject afterwards, turning a readable 400 into an integrity error
    investigationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
    },
    // The ENUM takes its values from the shared constants file, never from literals written here:
    // model and validator must not be able to drift apart
    usedAutoDisableSyringes: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    // BOOLEAN and not ENUM, for the four of them: the model has to match the column
    usedGlassSyringes: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    usedDisposableSyringes: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    usedRecycledDisposableSyringes: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    usedOtherSyringes: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    // NONE of the ten text columns carries a length, because none of them is a varchar in the DDL.
    // It is the difference with investigationColdChain, which did cap transportTypeThermo at 250:
    // inventing a limit in the validator would create a 400 the database does not back
    otherSyringesDescription: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    syringesKeyFindings: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    reconstitutionUsedSameSyringe: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    reconstitutionUsedSameSyringeDifferentVaccine: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    reconstitutionUsedDifferentSyringeSameVial: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    reconstitutionUsedDifferentSyringeDifferentVaccine: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    reconstitutionFollowedManufacturerRecommendation: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    reconstitutionKeyFindings: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    hadPrescriptionError: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    prescriptionErrorNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    hadContaminatedVaccine: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    contaminatedVaccineNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    hadAbnormalVaccineConditions: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    abnormalConditionsNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    hadPreparationError: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    preparationErrorNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    hadHandlingError: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    handlingErrorNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    hadImproperAdministration: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    improperAdministrationNotes: {
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
    // TRG_investigationAdministrationError_setSysDetails of the loop at esaviapp.sql:1290-1305, and
    // no trigger touches updatedAt
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
    tableName: 'investigationAdministrationError',
    modelName: 'InvestigationAdministrationError',
    timestamps: false,
    freezeTableName: true,
});
