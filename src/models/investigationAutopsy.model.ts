import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Investigation } from './investigation.model';
import { AppDetails } from '../types';

export class InvestigationAutopsy extends Model<InferAttributes<InvestigationAutopsy>, InferCreationAttributes<InvestigationAutopsy>> {
    // Primary key and foreign key at the same time, like investigationSource and the two
    // notification satellites: the row does not identify itself, it is identified by the
    // investigation it details. The PK already is the one to one, so the DDL declares no extra
    // UNIQUE (esaviapp.sql:977)
    declare investigationId: ForeignKey<Investigation['investigationId']>;

    // The only NOT NULL data column of the table (esaviapp.sql:978), and the first required field
    // of a satellite in this repository. It is not tri-state: this spec restricts it further and
    // only admits true, because a row of autopsy without a death recorded is not a draft, it is a
    // contradiction. It is immutable afterwards — the update service ignores it
    declare isDeath: boolean;

    // Date of the death. Nullable in the DDL but required by business rule, and modifiable but not
    // erasable afterwards: emptying it would reopen through the back door what the create forbids
    declare deathDate?: CreationOptional<string | null>;

    // Time of the death, and the first `time` column of the repository. It travels normalized to
    // HH:mm:ss through toTimeString, which is what keeps a client sending '14:30' over a stored
    // '14:30:00' from producing an invented difference on every open of the form
    declare deathTime?: CreationOptional<string | null>;

    // The two autopsy flags. Nullable booleans and therefore tri-state: null means "the form did
    // not collect it", which is not false — that one is a deliberate "no" from the investigator.
    // Unlike what SPEC F29 §6 claims, this entity does not consume answerOption: the DDL declares
    // them plain boolean (esaviapp.sql:981-982). They are mutually exclusive in true, and each one
    // governs its own date, both rules enforced by the service over the resulting state
    declare isAutopsyPerformed?: CreationOptional<boolean | null>;
    declare isAutopsyScheduled?: CreationOptional<boolean | null>;

    // Governed by isAutopsyPerformed. Cannot be earlier than the resulting deathDate
    declare autopsyDate?: CreationOptional<string | null>;

    // Governed by isAutopsyScheduled, and the one date with no temporal restriction at all: an
    // autopsy scheduled and never performed is a real state of the domain, and a historical load
    // is the normal way of populating this table
    declare scheduledAutopsyDate?: CreationOptional<string | null>;

    declare autopsyComments?: CreationOptional<string | null>;
    declare notes?: CreationOptional<string | null>;

    // No activity flag is declared, and this is the fourth model of the repository without one,
    // after severeNotification, nonSevereNotification and investigationSource: the DDL does not
    // have that column (esaviapp.sql:976-993) and this entity does not manage its own state. Its
    // visibility is inherited from the activity flag of its investigation, and deletedAt is the
    // only status mark the row carries
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare investigation?: NonAttribute<Investigation>;
}

InvestigationAutopsy.init({
    // Deliberately without defaultValue, for the same reason as investigationSource and the two
    // notification satellites: declaring gen_random_uuid() would let a create without
    // investigationId generate an orphan UUID that the FK would reject afterwards, turning a
    // readable 400 into an integrity error
    investigationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
    },
    // Without defaultValue on purpose, even though the DDL declares DEFAULT true. An application
    // default would mark a living patient as deceased when the client simply forgot the key, and
    // that is the worst possible error of this entity: the validator demands the value instead
    isDeath: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
    },
    // The three dates are DATEONLY and never DATE: the columns are `date`, and DATEONLY is what
    // returns the 'YYYY-MM-DD' string the comparison rule of buildDifferentialUpdate expects.
    // DATE would return a Date with a time zone and make that rule compare different things
    // depending on the host of the server
    deathDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    deathTime: {
        type: DataTypes.TIME,
        allowNull: true,
    },
    // Both flags stay nullable, which is what keeps the third state alive: a column declared
    // NOT NULL DEFAULT false would answer "no" to a question nobody was ever asked
    isAutopsyPerformed: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    isAutopsyScheduled: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    autopsyDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    scheduledAutopsyDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    // Both texts are declared TEXT and carry no length: the DDL has no varchar(n) here, so there
    // is no limit to replicate
    autopsyComments: {
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
    // Written by the application: unlike most tables of the schema, this one carries no
    // TRG_investigationAutopsy_setUpdatedAt — the DDL drops it and never creates it
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
    tableName: 'investigationAutopsy',
    modelName: 'InvestigationAutopsy',
    timestamps: false,
    freezeTableName: true,
});
