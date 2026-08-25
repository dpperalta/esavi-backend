import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Investigation } from './investigation.model';
import { CatalogItem } from './catalogItem.model';
import { ANSWER_OPTIONS, AnswerOption } from '../constants/enums.constants';
import { AppDetails } from '../types';

// The context of the vaccination session in which the investigated dose was administered: in which
// time slot it was applied, how many people were vaccinated from the same vial and the same batch,
// and whether the case belongs to a cluster. Sixth table with a direct FK to investigation to get
// its own spec, and the first of the repository with two foreign keys resolved against the same
// catalog - which is why the two belongsTo carry aliases and those aliases must differ
export class InvestigationVaccinationContext extends Model<InferAttributes<InvestigationVaccinationContext>, InferCreationAttributes<InvestigationVaccinationContext>> {
    // Primary key and foreign key at the same time, like investigationSource, investigationAutopsy,
    // investigationMedicalHistory, investigationClinicalEvaluation and the two notification
    // satellites: the row does not identify itself, it is identified by the investigation whose
    // vaccination session it describes. The PK already is the one to one, so the DDL declares no
    // extra UNIQUE (esaviapp.sql:1134)
    declare investigationId: ForeignKey<Investigation['investigationId']>;

    // The time slot of the session, asked separately for the single-dose presentation and for the
    // multidose vial. Both are resolved against the SAME vaccinationMoment catalog, both are
    // nullable, both are independent of each other and NEITHER GOVERNS ANYTHING: no field of this
    // table depends on their value. The FK of the DDL cannot tell the catalogType apart, so the only
    // defence against an item of sex stored here is the double hop the service checks
    declare momentItemId?: CreationOptional<string | null>;
    declare multidoseItemId?: CreationOptional<string | null>;

    // The shared exposure. SMALLINT and not INTEGER on purpose: making the model type match the
    // column type is what turns the 32767 ceiling into a declared property instead of an accident.
    // 0 is a valid value - "nobody else was vaccinated from that vial" is clinically relevant data -
    // so no candidate of the update service may ever enter under a truthiness check
    declare vaccinatedPerVialCount?: CreationOptional<number | null>;
    declare vaccinatedPerBatchCount?: CreationOptional<number | null>;

    // Free text with no structure, exactly as the DDL declares it. Only trim() on write
    declare locations?: CreationOptional<string | null>;

    // THE KEY OF THE CLUSTER BLOCK, and the field most easily read backwards. It is an answerOption
    // of five values and not a boolean, so the "no" has FIVE forms - 'NO', 'UNKNOWN',
    // 'NOT_APPLICABLE', 'NO_ANSWER' and null - and the five close the block alike. ONLY 'YES' OPENS
    // IT. It governs the four fields below; it is the field that decides, not one of the decided
    declare isCluster?: CreationOptional<AnswerOption | null>;

    // The four fields of the cluster block. With the block open the four are optional and nothing is
    // required of them; with the block closed the four are forbidden - 400 on create, and forced to
    // null as conditional derivatives on update. clusterUsedSameVial is both things at once: a field
    // of the block and, in turn, the key of clusterSameVialCount through the shared vial rule
    declare clusterIdentificationNumber?: CreationOptional<string | null>;
    declare clusterAdditionalCaseCount?: CreationOptional<number | null>;
    declare clusterUsedSameVial?: CreationOptional<AnswerOption | null>;
    declare clusterSameVialCount?: CreationOptional<number | null>;

    declare notes?: CreationOptional<string | null>;

    // No activity flag is declared, and this is the seventh model of the repository without one,
    // after severeNotification, nonSevereNotification, investigationSource, investigationAutopsy,
    // investigationMedicalHistory and investigationClinicalEvaluation: the DDL does not have that
    // column (esaviapp.sql:1133-1155) and this entity does not manage its own state. Its visibility
    // is inherited from the activity flag of its investigation, and deletedAt is the only status
    // mark the row carries
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare investigation?: NonAttribute<Investigation>;
    declare moment?: NonAttribute<CatalogItem>;
    declare multidoseMoment?: NonAttribute<CatalogItem>;
}

InvestigationVaccinationContext.init({
    // Deliberately without defaultValue, for the same reason as investigationSource,
    // investigationAutopsy, investigationMedicalHistory, investigationClinicalEvaluation and the two
    // notification satellites: declaring gen_random_uuid() would let a create without
    // investigationId generate an orphan UUID that the FK would reject afterwards, turning a
    // readable 400 into an integrity error
    investigationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
    },
    momentItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    multidoseItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    // The four counters are SMALLINT and not INTEGER: the ceiling of 32767 belongs to the column
    // type and nothing else replicates it. The CHECK >= 0 of the DDL covers the floor; the validator
    // replicates both so an overflow is a readable 400 and not a 500 from Postgres
    vaccinatedPerVialCount: {
        type: DataTypes.SMALLINT,
        allowNull: true,
    },
    vaccinatedPerBatchCount: {
        type: DataTypes.SMALLINT,
        allowNull: true,
    },
    locations: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    // The ENUM takes its values from the shared constants file, never from literals written here:
    // model and validator must not be able to drift apart
    isCluster: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    // The length is explicit so an overlong text fails in Sequelize and not in Postgres. It is the
    // only varchar(n) of the table; locations and notes carry no limit in the DDL and stay TEXT
    clusterIdentificationNumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
    },
    clusterAdditionalCaseCount: {
        type: DataTypes.SMALLINT,
        allowNull: true,
    },
    clusterUsedSameVial: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    clusterSameVialCount: {
        type: DataTypes.SMALLINT,
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
    // TRG_investigationVaccinationContext_setSysDetails of the loop at esaviapp.sql:1286-1302, and
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
    tableName: 'investigationVaccinationContext',
    modelName: 'InvestigationVaccinationContext',
    timestamps: false,
    freezeTableName: true,
});
