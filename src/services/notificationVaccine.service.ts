import { InferAttributes, Transaction } from 'sequelize';
import { EsaviCase, Notification, NotificationVaccine, VaccineWhodrug } from '../models';
import { AppError, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateNotificationVaccineInput } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The columns the INSERT of ESAVI-NOTIFVAC-001 writes, listed one by one so sortOrder stays out of
// it. Omitting the value is not enough: the column is allowNull: false and Sequelize runs its own
// notNull validation over every attribute of the create before reaching Postgres, so an unlisted
// sortOrder would be rejected in the application and TRG_notificationVaccine_setSortOrder would
// never get to assign it. Passing the field list is what makes the column absent from the
// statement. vaccineId is out for the same reason it is out of the body: gen_random_uuid() writes it
const CREATE_FIELDS: (keyof InferAttributes<NotificationVaccine>)[] = [
    'notificationId',
    'vaccineWhodrugId',
    'isSuspected',
    'whoCode',
    'vaccineCode',
    'vaccineName',
    'vaccinationDate',
    'vaccinationTime',
    'doseNumber',
    'batchNumber',
    'expirationDate',
    'notes',
    'isActive',
    'appDetails'
];

// The header is read on every operation to implement the inherited visibility, and it is read with
// two attributes because that is all the check needs. It never reaches the response — whoever needs
// the header enters through ESAVI-NOTIFCN-003
const NOTIFICATION_INCLUDE = {
    model: Notification,
    as: 'notification',
    attributes: ['notificationId', 'isActive']
};

// The resolved master entry, with three fields. The other twenty six columns of vaccineWhodrug are
// governance of the dictionary, not data of the notification: whoever needs the whole record enters
// through ESAVI-WHODRUG-003.
//
// The include does not filter by isActive, deliberately. An entry retired after the record was
// written still says which vaccine was given: the row is historical, and F18 decided that
// deactivating means "stops being offered in the autocomplete", not "stops existing"
const VACCINE_WHODRUG_INCLUDE = {
    model: VaccineWhodrug,
    as: 'vaccineWhodrug',
    attributes: ['vaccineWhodrugId', 'drugCode', 'drugName']
};

// sysDetails is trigger metadata and never leaves the service. The header is dropped here after
// having done its job in the query, and the master entry comes back as an explicit null when the
// vaccine was notified without being coded, so a client does not have to tell "empty" from
// "absent".
//
// The raw foreign key travels next to the resolved object, as in notificationEvent and
// notificationMedication: the 004 accepts vaccineWhodrugId in the body, so a PUT resending the
// response of its GET needs to find it there
const toNotificationVaccineResponse = (notificationVaccine: NotificationVaccine) => {
    const plain = notificationVaccine.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;
    delete plain.notification;

    plain.vaccineWhodrug = plain.vaccineWhodrug ?? null;

    return plain;
}

// The read every operation shares to build its response. The header include is mandatory and not
// decorative: with required: true and the isActive filter it is what implements the inherited
// visibility, so a vaccine hanging from a retired notification simply does not come back
const findNotificationVaccineWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await NotificationVaccine.findOne({
        where: includeInactive ? { vaccineId: id } : { vaccineId: id, isActive: true },
        include: [
            {
                ...NOTIFICATION_INCLUDE,
                required: true,
                where: includeInactive ? {} : { isActive: true }
            },
            VACCINE_WHODRUG_INCLUDE
        ]
    });
}

// The notification must exist and be active: a retired header does not take a new vaccine. No check
// by notificationType — the administered vaccines are recorded the same way whether the
// notification is severe or not.
//
// The case is included with two attributes because the create needs its eventDate for the temporal
// coherence rule, and reading it here saves a second query
const findValidNotification = async (notificationId: string, op: string, lang: string, transaction?: Transaction) => {
    const notification = await Notification.findOne({
        where: { notificationId, isActive: true },
        attributes: ['notificationId'],
        include: [{
            model: EsaviCase,
            as: 'case',
            attributes: ['caseId', 'eventDate']
        }],
        transaction
    });
    if( !notification ) {
        throw new AppError(
            getMessage('notificationVaccine.notificationNotFound', lang),
            404,
            `NOTIFVAC_${ op }_NOTIFICATION_NOT_FOUND`
        );
    }
    return notification;
}

// The same check as above, relaxed by canViewInactive: the inherited visibility applied to the
// listings, where the header is not the target of the write but the gate to the collection. A
// retired notification answers 404 for USER and ADMIN, and comes back for whoever may see inactive
// rows — today SUPERADMIN.
//
// It does not read the case: no listing needs eventDate, which is only used by the two writes
const assertNotificationIsVisible = async (
    notificationId: string,
    op: string,
    lang: string,
    canViewInactive: boolean = false
) => {
    const where = canViewInactive ? { notificationId } : { notificationId, isActive: true };
    const notification = await Notification.findOne({ where, attributes: ['notificationId'] });
    if( !notification ) {
        throw new AppError(
            getMessage('notificationVaccine.notificationNotFound', lang),
            404,
            `NOTIFVAC_${ op }_NOTIFICATION_NOT_FOUND`
        );
    }
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all. None of them goes through toTitleCase, against the letter of CONVENTIONS.md §11:
// vaccine names are mostly acronyms — BCG, SRP, DPT, VPH, COVID-19 mRNA — and title casing would
// mutilate them into Bcg or Covid-19 Mrna, destroying the only value the column has, which is
// reproducing what the notifier read on the vaccination card
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// A `time` column reads back from pg as 'HH:MM:SS', and the validator admits 'HH:MM' because a form
// that only asks for hours and minutes must not have to invent the seconds. Padding them here is
// what keeps a PUT sending '14:30' over a stored '14:30:00' from counting as a change: Postgres
// would store the very same value and the row would still gain an audit entry
const normalizeTime = (value: string | null | undefined): string | null => {
    const trimmed = normalizeText(value);
    if( !trimmed ) return null;
    return trimmed.length === 5 ? `${ trimmed }:00` : trimmed;
}

// The minimum content guard, shared by 001 and 004. The DDL leaves the eleven data columns nullable
// without exception, so it admits a row that only says "this notification has a vaccine" without
// saying which one — that is not a record, it is noise with a sortOrder.
//
// Requiring one of the two branches and not a specific one is what respects the "coded or raw"
// design F18 fixed for this table: a coded vaccine does not need the name copied over, and a
// vaccine the dictionary does not list is still perfectly reportable by name.
//
// It lives here and not in the validator because on update it is evaluated over the resulting state
// — the stored row merged with what arrives — and the validator only sees the body
const assertMinimumContent = (
    vaccineWhodrugId: string | null | undefined,
    vaccineName: string | null | undefined,
    op: string,
    lang: string
) => {
    if( !vaccineWhodrugId && !normalizeText(vaccineName) ) {
        throw new AppError(
            getMessage('notificationVaccine.vaccineRequired', lang),
            400,
            `NOTIFVAC_${ op }_VACCINE_REQUIRED`
        );
    }
}

// The master entry must exist and be active. A plain findOne over the table is enough, without the
// double hop against catalogType that nonSevereNotification and notificationMedication needed:
// vaccineWhodrug is a standalone master and hangs from no catalog type, so replicating that pattern
// here would be copying a solution without its problem.
//
// Choosing a retired entry today is an error; having chosen it yesterday is a fact, which is why
// the reads do not filter by isActive.
//
// The key is optional: absent or null nothing is checked, and the row stays uncoded — a legitimate
// state, and the reason an empty master does not block the notification
const assertVaccineWhodrugIsValid = async (
    vaccineWhodrugId: string | null | undefined,
    op: string,
    lang: string
) => {
    if( !vaccineWhodrugId ) return;

    const vaccineWhodrug = await VaccineWhodrug.findOne({
        where: { vaccineWhodrugId, isActive: true },
        attributes: ['vaccineWhodrugId']
    });
    if( !vaccineWhodrug ) {
        throw new AppError(
            getMessage('notificationVaccine.whodrugNotFound', lang),
            404,
            `NOTIFVAC_${ op }_WHODRUG_NOT_FOUND`
        );
    }
}

// The temporal coherence rule, shared by 001 and 004. An ESAVI is by definition an event after the
// immunization, so a vaccine administered after the event it is blamed for is an impossible datum,
// not a rare case.
//
// It compares against esaviCase.eventDate and not against notificationEvent.startDate: the date of
// the ESAVI is a single one and lives in the case, while the notified events are the diagnoses,
// they are N, and their date answers another question.
//
// The same day is valid: an immediate reaction is recorded with the date of the vaccination, and
// requiring strictly later would invalidate the most acute cases.
//
// It does not apply when either date is missing, which is the ordinary case and not the exception:
// vaccines are usually loaded before the case has an eventDate. Both values are cut to their first
// ten characters, so an ISO 8601 string with time compares as the calendar date it denotes
const assertVaccinationDateIsCoherent = (
    vaccinationDate: string | null | undefined,
    eventDate: string | null | undefined,
    op: string,
    lang: string
) => {
    if( !vaccinationDate || !eventDate ) return;

    if( vaccinationDate.slice(0, 10) > eventDate.slice(0, 10) ) {
        throw new AppError(
            getMessage('notificationVaccine.vaccinationAfterEvent', lang),
            400,
            `NOTIFVAC_${ op }_VACCINATION_AFTER_EVENT`
        );
    }
}

// Create Notification Vaccine Service
// Code: ESAVI-NOTIFVAC-001
// No transaction of its own, as in notificationMedication and unlike notificationEvent: nothing is
// written outside this table — there is no master to mint against, F18 ruled out implicit
// resolution, and no field is derived — so the create is a single statement and the implicit
// transaction of Sequelize is enough
const createNotificationVaccineService = async (
    data: CreateNotificationVaccineInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    const notification = await findValidNotification(data.notificationId, '001', lang);

    // On create the body is the whole resulting state, so the guards are evaluated over it directly
    assertMinimumContent(data.vaccineWhodrugId, data.vaccineName, '001', lang);

    await assertVaccineWhodrugIsValid(data.vaccineWhodrugId, '001', lang);

    assertVaccinationDateIsCoherent(data.vaccinationDate, notification.case?.eventDate, '001', lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-NOTIFVAC-001',
        detail: 'Notification vaccine created by service'
    };

    // sortOrder is deliberately absent from the create: leaving the column out of the INSERT is
    // what lets TRG_notificationVaccine_setSortOrder assign it, under the advisory lock that keeps
    // two concurrent inserts from colliding. Sending an explicit 0 would work by accident, not by
    // contract
    const created = await NotificationVaccine.create({
        notificationId: data.notificationId,
        vaccineWhodrugId: data.vaccineWhodrugId ?? null,
        isSuspected: data.isSuspected ?? false,
        whoCode: normalizeText(data.whoCode),
        vaccineCode: normalizeText(data.vaccineCode),
        vaccineName: normalizeText(data.vaccineName),
        vaccinationDate: data.vaccinationDate ?? null,
        vaccinationTime: normalizeTime(data.vaccinationTime),
        doseNumber: data.doseNumber ?? null,
        batchNumber: normalizeText(data.batchNumber),
        expirationDate: data.expirationDate ?? null,
        notes: normalizeText(data.notes),
        isActive: data.isActive ?? true,
        appDetails: [newEntry]
    }, { fields: CREATE_FIELDS });

    // Re-read so the response carries the resolved master entry and the sortOrder the trigger
    // assigned, which the create instance does not know
    const notificationVaccine = await findNotificationVaccineWithRelations(created.vaccineId, true);
    return notificationVaccine ? toNotificationVaccineResponse(notificationVaccine) : null;
}

// Get Active Notification Vaccines By Notification Service
// Code: ESAVI-NOTIFVAC-002A
// The listing is entered by the foreign key and never by /: a vaccine does not exist without its
// notification, and a global listing of notified vaccines has no reader.
//
// The header guard is the inherited visibility applied to a collection: a retired notification
// answers 404 instead of an empty page, because an empty page would say "this notification has no
// vaccines" to somebody who is simply not allowed to see them.
//
// Ordered by sortOrder ascending, which is the whole point of the column, and with no filter by
// isSuspected, vaccineWhodrugId, batchNumber, dates or text — those are out of the scope of this
// spec
const getNotificationVaccinesByNotificationService = async (
    notificationId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await assertNotificationIsVisible(notificationId, '002A', lang, canViewInactive);

    const notificationVaccines = await NotificationVaccine.findAndCountAll({
        where: { notificationId, isActive: true },
        include: [VACCINE_WHODRUG_INCLUDE],
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });

    return {
        count: notificationVaccines.count,
        rows: notificationVaccines.rows.map(toNotificationVaccineResponse)
    };
}

// Get All Notification Vaccines By Notification Service - For Admin
// Code: ESAVI-NOTIFVAC-002B
// The same listing as 002A without the isActive filter: it is the only door to a vaccine that was
// retired, and therefore the entry point of whoever is going to reactivate or purge it.
// paranoid: false is declarative here — the model is not paranoid, so deletedAt is a plain column
// and no scope would hide the sealed rows — and it is written for the same reason
// entityActivation.service.ts:21 writes it: the intent is to see everything, including what a 005A
// sealed
const getAllNotificationVaccinesByNotificationService = async (
    notificationId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await assertNotificationIsVisible(notificationId, '002B', lang, canViewInactive);

    const notificationVaccines = await NotificationVaccine.findAndCountAll({
        where: { notificationId },
        include: [VACCINE_WHODRUG_INCLUDE],
        order: [['sortOrder', 'ASC']],
        paranoid: false,
        limit,
        offset
    });

    return {
        count: notificationVaccines.count,
        rows: notificationVaccines.rows.map(toNotificationVaccineResponse)
    };
}

// Get Notification Vaccine By ID Service
// Code: ESAVI-NOTIFVAC-003
// Two filters, and the second one is the inherited visibility: the vaccine must exist and be
// active, and its notification must be active too, unless canViewInactive says otherwise — today
// SUPERADMIN. The three failures answer the same 404 without distinguishing, because telling them
// apart would confirm to a USER that a vaccine exists under a notification it is not allowed to see
const getNotificationVaccineByIdService = async (id: string, lang: string, canViewInactive: boolean = false) => {
    const notificationVaccine = await findNotificationVaccineWithRelations(id, canViewInactive);
    if( !notificationVaccine ) {
        throw new AppError(getMessage('notificationVaccine.notFound', lang), 404, 'NOTIFVAC_003_NOT_FOUND');
    }
    return toNotificationVaccineResponse(notificationVaccine);
}

// Get Notification Vaccines By Case ID Service
// Code: ESAVI-NOTIFVAC-006
// The real query of the domain: the client holds the caseId, not the notificationId. The chain
// case -> notification is one to one, but N vaccines hang from the notification, so like the 006 of
// notificationEvent and notificationMedication this one returns { count, rows } and not a single
// record.
//
// The two 404 are deliberately distinct — the client enters through a caseId and needs to know
// which link of the chain broke — and from there it is the 002A: active vaccines only, ordered by
// sortOrder. No admin variant is declared: the rows carry the notificationId, which is the entry to
// the 002B for whoever needs to see the retired ones
const getNotificationVaccinesByCaseIdService = async (
    caseId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const esaviCase = await EsaviCase.findOne({
        where: { caseId, isActive: true },
        attributes: ['caseId']
    });
    if( !esaviCase ) {
        throw new AppError(getMessage('notificationVaccine.caseNotFound', lang), 404, 'NOTIFVAC_006_CASE_NOT_FOUND');
    }

    const where = canViewInactive ? { caseId } : { caseId, isActive: true };
    const notification = await Notification.findOne({ where, attributes: ['notificationId'] });
    if( !notification ) {
        throw new AppError(
            getMessage('notificationVaccine.notificationNotFound', lang),
            404,
            'NOTIFVAC_006_NOTIFICATION_NOT_FOUND'
        );
    }

    const notificationVaccines = await NotificationVaccine.findAndCountAll({
        where: { notificationId: notification.notificationId, isActive: true },
        include: [VACCINE_WHODRUG_INCLUDE],
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });

    return {
        count: notificationVaccines.count,
        rows: notificationVaccines.rows.map(toNotificationVaccineResponse)
    };
}

export {
    createNotificationVaccineService,
    getAllNotificationVaccinesByNotificationService,
    getNotificationVaccineByIdService,
    getNotificationVaccinesByCaseIdService,
    getNotificationVaccinesByNotificationService
};
