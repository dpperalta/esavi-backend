import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { NotificationVaccine } from './notificationVaccine.model';
import { DiluentCatalog } from './diluentCatalog.model';
import { AppDetails } from '../types';

// The diluent each notified vaccine was reconstituted with: which liquid was added to the vial, its
// batch, its expiration and when the reconstitution happened. Sixth satellite of notification and
// fourth of the one to many family, so it shares the shape of notificationEvent,
// notificationMedication and notificationVaccine: diluentId is its own primary key, vaccineId is a
// separate column and sortOrder keeps the order among siblings. Two traits are its own: it is the
// first grandchild of the graph - it hangs from notificationVaccine, not from notification, so its
// inherited visibility is a two level chain - and it is the first and only consumer of the
// diluentCatalog master
export class NotificationDiluent extends Model<InferAttributes<NotificationDiluent>, InferCreationAttributes<NotificationDiluent>> {
    declare diluentId: CreationOptional<string>;
    declare vaccineId: ForeignKey<NotificationVaccine['vaccineId']>;

    // Nullable on purpose: a null key means "notified but not coded", which is a legitimate state.
    // The notification is never blocked by a diluent the master does not list
    declare diluentCatalogId?: CreationOptional<string | null>;

    // Assigned by TRG_notificationDiluent_setSortOrder (BEFORE INSERT only) and protected by the
    // partial unique index over (vaccineId, sortOrder) WHERE deletedAt IS NULL. Declared without
    // defaultValue on purpose: a defaultValue of 0 would make the INSERT send an explicit 0, which
    // is exactly the value the trigger reads as "assign it yourself". The create omits the column
    // instead, and nothing but ESAVI-NOTIFDIL-005B ever writes it
    declare sortOrder?: CreationOptional<number>;

    // The batch of the diluent, not the one of the vaccine
    declare batchNumber?: CreationOptional<string | null>;

    // No rule crosses it with anything: a diluent used after expiring is precisely the finding an
    // ESAVI documents, and a 400 there would block the very case being reported
    declare expirationDate?: CreationOptional<string | null>;

    // Date and time in separate columns because the DDL separates them: the hour is frequently
    // unknown, and merging them would force inventing it. Only the date takes part in the temporal
    // coherence rule against notificationVaccine.vaccinationDate
    declare reconstitutionDate?: CreationOptional<string | null>;
    declare reconstitutionTime?: CreationOptional<string | null>;

    // The copy of what was transcribed from the vial. Never derived from the master: if the vial
    // says one thing and the catalog another, the notification has to be able to say both. Only
    // trimmed and never title cased, so the name reads as the notifier wrote it
    declare diluentName?: CreationOptional<string | null>;
    declare diluentCode?: CreationOptional<string | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare vaccine?: NonAttribute<NotificationVaccine>;
    declare diluentCatalog?: NonAttribute<DiluentCatalog>;
}

NotificationDiluent.init({
    diluentId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    vaccineId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    diluentCatalogId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    sortOrder: {
        type: DataTypes.SMALLINT,
        allowNull: false,
    },
    // The lengths are explicit so an overlong text fails in Sequelize and not in Postgres. The
    // three of them share the same width because the DDL gives them the same one
    batchNumber: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    // DATEONLY and not DATE: the columns are `date`, and DATE would carry a time zone
    expirationDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    reconstitutionDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    reconstitutionTime: {
        type: DataTypes.TIME,
        allowNull: true,
    },
    diluentName: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    diluentCode: {
        type: DataTypes.STRING(250),
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
    tableName: 'notificationDiluent',
    modelName: 'NotificationDiluent',
    timestamps: false,
    freezeTableName: true,
});
