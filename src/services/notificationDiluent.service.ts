import { InferAttributes } from 'sequelize';
import { DiluentCatalog, Notification, NotificationDiluent, NotificationVaccine } from '../models';
import { AppError, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateNotificationDiluentInput } from '../types';

// The columns the INSERT of ESAVI-NOTIFDIL-001 writes, listed one by one so sortOrder stays out of
// it. Omitting the value is not enough: the column is allowNull: false and Sequelize runs its own
// notNull validation over every attribute of the create before reaching Postgres, so an unlisted
// sortOrder would be rejected in the application and TRG_notificationDiluent_setSortOrder would
// never get to assign it. Passing the field list is what makes the column absent from the
// statement. diluentId is out for the same reason it is out of the body: gen_random_uuid() writes it
const CREATE_FIELDS: (keyof InferAttributes<NotificationDiluent>)[] = [
    'vaccineId',
    'diluentCatalogId',
    'batchNumber',
    'expirationDate',
    'reconstitutionDate',
    'reconstitutionTime',
    'diluentName',
    'diluentCode',
    'isActive',
    'appDetails'
];

// The parent chain, read on every operation to implement the inherited visibility. This is the one
// structurally new piece of the entity: notificationDiluent is the first grandchild of the graph, so
// the rule is not one hop but two — a perfectly active diluent is invisible if its vaccine was
// withdrawn, and also if the whole notification was.
//
// vaccinationDate travels in the same include so the temporal coherence rule costs no second query.
// Neither the vaccine nor the notification ever reaches the response: whoever needs them enters
// through ESAVI-NOTIFVAC-003 and ESAVI-NOTIFCN-003
const VACCINE_INCLUDE = {
    model: NotificationVaccine,
    as: 'vaccine',
    attributes: ['vaccineId', 'isActive', 'vaccinationDate'],
    include: [{
        model: Notification,
        as: 'notification',
        attributes: ['notificationId', 'isActive']
    }]
};

// The resolved master entry, with three fields. composition and description are the record of the
// product, not data of the notification: whoever needs the whole sheet enters through
// ESAVI-DILUENT-003, and this way the payload does not grow every time the master gains a column.
//
// The include does not filter by isActive, deliberately. An entry retired after the record was
// written still says what the vial was reconstituted with: the row is historical, and that is the
// asymmetry F14 reasoned and F21, F22 and F23 repeated
const DILUENT_CATALOG_INCLUDE = {
    model: DiluentCatalog,
    as: 'diluentCatalog',
    attributes: ['diluentCatalogId', 'code', 'name']
};

// sysDetails is trigger metadata and never leaves the service. The parent chain is dropped here
// after having done its job in the query, and the master entry comes back as an explicit null when
// the diluent was notified without being coded, so a client does not have to tell "empty" from
// "absent".
//
// The raw foreign key travels next to the resolved object, as in notificationEvent,
// notificationMedication and notificationVaccine: the 004 accepts diluentCatalogId in the body, so a
// PUT resending the response of its GET needs to find it there
const toNotificationDiluentResponse = (notificationDiluent: NotificationDiluent) => {
    const plain = notificationDiluent.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;
    delete plain.vaccine;

    plain.diluentCatalog = plain.diluentCatalog ?? null;

    return plain;
}

// The read every operation shares to build its response. The parent include is mandatory and not
// decorative: with required: true and the isActive filter over both levels it is what implements the
// inherited visibility, so a diluent hanging from a retired vaccine — or from a vaccine whose
// notification was retired — simply does not come back
const findNotificationDiluentWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await NotificationDiluent.findOne({
        where: includeInactive ? { diluentId: id } : { diluentId: id, isActive: true },
        include: [
            {
                ...VACCINE_INCLUDE,
                required: true,
                where: includeInactive ? {} : { isActive: true },
                include: [{
                    ...VACCINE_INCLUDE.include[0],
                    required: true,
                    where: includeInactive ? {} : { isActive: true }
                }]
            },
            DILUENT_CATALOG_INCLUDE
        ]
    });
}

// The vaccine must exist and be active, and so must its notification: a retired vaccine does not
// take a new diluent, and neither does one hanging from a retired header. The two levels are checked
// in the same query with the nested include, which is why this is a single read and not two.
//
// vaccinationDate comes back with it because the create needs it for the temporal coherence rule,
// and reading it here saves a second query
const findValidVaccine = async (vaccineId: string, op: string, lang: string) => {
    const vaccine = await NotificationVaccine.findOne({
        where: { vaccineId, isActive: true },
        attributes: ['vaccineId', 'vaccinationDate'],
        include: [{
            model: Notification,
            as: 'notification',
            attributes: ['notificationId'],
            required: true,
            where: { isActive: true }
        }]
    });
    if( !vaccine ) {
        throw new AppError(
            getMessage('notificationDiluent.vaccineNotFound', lang),
            404,
            `NOTIFDIL_${ op }_VACCINE_NOT_FOUND`
        );
    }
    return vaccine;
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all. None of them goes through toTitleCase, against the letter of CONVENTIONS.md §11: the
// column is the copy of what the notifier transcribed from the vial, and its only value is
// reproducing what the label says — title casing it would rewrite the record instead of storing it.
//
// This is the fourth copy of this helper in the repository. Extracting it is overdue and has its own
// spec pending, because doing it here would drag three foreign services into a CRUD
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// A `time` column reads back from pg as 'HH:MM:SS', and the validator admits 'HH:MM' because a form
// that only asks for hours and minutes must not have to invent the seconds. Padding them here is
// what keeps a PUT sending '09:15' over a stored '09:15:00' from counting as a change: Postgres
// would store the very same value and the row would still gain an audit entry
const normalizeTime = (value: string | null | undefined): string | null => {
    const trimmed = normalizeText(value);
    if( !trimmed ) return null;
    return trimmed.length === 5 ? `${ trimmed }:00` : trimmed;
}

// The minimum content guard, shared by 001 and 004. The DDL leaves the seven data columns nullable
// without exception — and unlike notificationVaccine there is not even a boolean with a default — so
// it admits a row that only says "this vaccine had a diluent" without saying which one. That is not
// a record, it is noise with a sortOrder, and here the hole is wider than the one F22 found.
//
// Requiring one of the two branches and not a specific one is what respects the "coded or raw"
// design F23 fixed for this table: a coded diluent does not need the name copied over, and a diluent
// the master does not list is still perfectly reportable by name.
//
// The case "it was reconstituted but I do not know with what" is resolved with an "Unknown" entry in
// the master and not by relaxing this guard, so ignorance is recorded as an explicit and countable
// value instead of an empty row indistinguishable from a loading error.
//
// It lives here and not in the validator because on update it is evaluated over the resulting state
// — the stored row merged with what arrives — and the validator only sees the body
const assertMinimumContent = (
    diluentCatalogId: string | null | undefined,
    diluentName: string | null | undefined,
    op: string,
    lang: string
) => {
    if( !diluentCatalogId && !normalizeText(diluentName) ) {
        throw new AppError(
            getMessage('notificationDiluent.diluentRequired', lang),
            400,
            `NOTIFDIL_${ op }_DILUENT_REQUIRED`
        );
    }
}

// The master entry must exist and be active. A plain findOne over the table is enough, without the
// double hop against catalogType that nonSevereNotification and notificationMedication needed:
// diluentCatalog is a standalone master and hangs from no catalog type, so replicating that pattern
// here would be copying a solution without its problem.
//
// Choosing a retired entry today is an error; having chosen it yesterday is a fact, which is why the
// reads do not filter by isActive.
//
// The key is optional: absent or null nothing is checked, and the row stays uncoded — a legitimate
// state, and the reason an empty master does not block the notification
const assertDiluentCatalogIsValid = async (
    diluentCatalogId: string | null | undefined,
    op: string,
    lang: string
) => {
    if( !diluentCatalogId ) return;

    const diluentCatalog = await DiluentCatalog.findOne({
        where: { diluentCatalogId, isActive: true },
        attributes: ['diluentCatalogId']
    });
    if( !diluentCatalog ) {
        throw new AppError(
            getMessage('notificationDiluent.catalogNotFound', lang),
            404,
            `NOTIFDIL_${ op }_CATALOG_NOT_FOUND`
        );
    }
}

// Create Notification Diluent Service
// Code: ESAVI-NOTIFDIL-001
// No transaction of its own, as in notificationMedication and notificationVaccine: nothing is
// written outside this table — F23 ruled out implicit resolution against the master and no field is
// derived — so the create is a single statement and the implicit transaction of Sequelize is enough
const createNotificationDiluentService = async (
    data: CreateNotificationDiluentInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    await findValidVaccine(data.vaccineId, '001', lang);

    // On create the body is the whole resulting state, so the guards are evaluated over it directly
    assertMinimumContent(data.diluentCatalogId, data.diluentName, '001', lang);

    await assertDiluentCatalogIsValid(data.diluentCatalogId, '001', lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-NOTIFDIL-001',
        detail: 'Notification diluent created by service'
    };

    // sortOrder is deliberately absent from the create: leaving the column out of the INSERT is what
    // lets TRG_notificationDiluent_setSortOrder assign it, under the advisory lock that keeps two
    // concurrent inserts from colliding. Sending an explicit 0 would work by accident, not by
    // contract.
    //
    // diluentName and diluentCode are only trimmed, never title cased and never derived from the
    // master: if the vial says one thing and the catalog another, the notification has to be able to
    // say both
    const created = await NotificationDiluent.create({
        vaccineId: data.vaccineId,
        diluentCatalogId: data.diluentCatalogId ?? null,
        batchNumber: normalizeText(data.batchNumber),
        expirationDate: data.expirationDate ?? null,
        reconstitutionDate: data.reconstitutionDate ?? null,
        reconstitutionTime: normalizeTime(data.reconstitutionTime),
        diluentName: normalizeText(data.diluentName),
        diluentCode: normalizeText(data.diluentCode),
        isActive: data.isActive ?? true,
        appDetails: [newEntry]
    }, { fields: CREATE_FIELDS });

    // Re-read so the response carries the resolved master entry and the sortOrder the trigger
    // assigned, which the create instance does not know
    const notificationDiluent = await findNotificationDiluentWithRelations(created.diluentId, true);
    return notificationDiluent ? toNotificationDiluentResponse(notificationDiluent) : null;
}

export {
    createNotificationDiluentService
};
