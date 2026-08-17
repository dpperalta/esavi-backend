import { InferAttributes, Transaction } from 'sequelize';
import { CatalogItem, CatalogType, Notification, NotificationMedication } from '../models';
import { AppError, getMessage, toTitleCase } from '../helpers';
import { AppDetails, AuthUser, CreateNotificationMedicationInput } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// Codes of the two catalogTypes these foreign keys point at. Nothing in the database checks them:
// the only validateCatalogItemType trigger of the DDL is the one of healthFacility, so without
// these constants any active catalogItem of the system — a facility type, a sex — would enter as a
// pharmaceutical form.
// catalogType codes are stored in camelCase — catalogType.service.ts:12
const PHARMACEUTICAL_FORM_CATALOG_CODE = 'pharmaceuticalForm';
const ADMINISTRATION_ROUTE_CATALOG_CODE = 'administrationRoute';

// The columns the INSERT of ESAVI-NOTIFMED-001 writes, listed one by one so sortOrder stays out of
// it. Omitting the value is not enough: the column is allowNull: false and Sequelize runs its own
// notNull validation over every attribute of the create before reaching Postgres, so an unlisted
// sortOrder would be rejected in the application and TRG_notificationMedication_setSortOrder would
// never get to assign it. Passing the field list is what makes the column absent from the
// statement. medicationId is out for the same reason it is out of the body: gen_random_uuid()
// writes it
const CREATE_FIELDS: (keyof InferAttributes<NotificationMedication>)[] = [
    'notificationId',
    'medicationName',
    'medicationCode',
    'dose',
    'pharmaceuticalFormItemId',
    'administrationRouteItemId',
    'startDate',
    'isOtherMedication',
    'otherMedicationText',
    'isActive',
    'appDetails'
];

// The header is read on every operation to implement the inherited visibility, and it is read with
// two attributes because that is all the check needs. It never reaches the response — whoever
// needs the header enters through ESAVI-NOTIFCN-003
const NOTIFICATION_INCLUDE = {
    model: Notification,
    as: 'notification',
    attributes: ['notificationId', 'isActive']
};

// The two resolved catalog items, with three fields each. sortOrder, value and catalogTypeId stay
// out: they are governance of the catalog, not data of the notification.
//
// Neither include filters by isActive, deliberately. An item retired after the record was written
// still describes in which form and by which route the medication was given: the row is historical,
// and filtering here would return null where there is stored data
const PHARMACEUTICAL_FORM_INCLUDE = {
    model: CatalogItem,
    as: 'pharmaceuticalForm',
    attributes: ['catalogItemId', 'code', 'name']
};

const ADMINISTRATION_ROUTE_INCLUDE = {
    model: CatalogItem,
    as: 'administrationRoute',
    attributes: ['catalogItemId', 'code', 'name']
};

// sysDetails is trigger metadata and never leaves the service. The header is dropped here after
// having done its job in the query, and the two catalog items come back as explicit nulls when the
// notifier did not choose them, so a client does not have to tell "empty" from "absent".
//
// The raw foreign keys travel next to the resolved objects, unlike nonSevereNotification: the 004
// accepts those two keys in the body, so a PUT resending the response of its GET needs to find
// them there
const toNotificationMedicationResponse = (notificationMedication: NotificationMedication) => {
    const plain = notificationMedication.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;
    delete plain.notification;

    plain.pharmaceuticalForm = plain.pharmaceuticalForm ?? null;
    plain.administrationRoute = plain.administrationRoute ?? null;

    return plain;
}

// The read every operation shares to build its response. The header include is mandatory and not
// decorative: with required: true and the isActive filter it is what implements the inherited
// visibility, so a medication hanging from a retired notification simply does not come back
const findNotificationMedicationWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await NotificationMedication.findOne({
        where: includeInactive ? { medicationId: id } : { medicationId: id, isActive: true },
        include: [
            {
                ...NOTIFICATION_INCLUDE,
                required: true,
                where: includeInactive ? {} : { isActive: true }
            },
            PHARMACEUTICAL_FORM_INCLUDE,
            ADMINISTRATION_ROUTE_INCLUDE
        ]
    });
}

// The notification must exist and be active: a retired header does not take a new medication. No
// check by notificationType — the concomitant medication is asked the same way whether the
// notification is severe or not, which is the single guard of the create
const assertNotificationIsValid = async (notificationId: string, op: string, lang: string, transaction?: Transaction) => {
    const notification = await Notification.findOne({
        where: { notificationId, isActive: true },
        attributes: ['notificationId'],
        transaction
    });
    if( !notification ) {
        throw new AppError(
            getMessage('notificationMedication.notificationNotFound', lang),
            404,
            `NOTIFMED_${ op }_NOTIFICATION_NOT_FOUND`
        );
    }
}

// The same check as above, relaxed by canViewInactive: the inherited visibility applied to the
// listings, where the header is not the target of the write but the gate to the collection. A
// retired notification answers 404 for USER and ADMIN, and comes back for whoever may see inactive
// rows — today SUPERADMIN
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
            getMessage('notificationMedication.notificationNotFound', lang),
            404,
            `NOTIFMED_${ op }_NOTIFICATION_NOT_FOUND`
        );
    }
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all. medicationCode goes through here and not through toConstantCase, against the letter
// of CONVENTIONS.md §11: that rule exists so uniqueness compares against a canonical value, and
// this column has no UNIQUE, no foreign key and no master behind it. Constant casing would only
// mutilate the transcription of a vademecum code — ABC-123 would become ABC_123 — destroying the
// only value the column has, which is reproducing what the notifier read on the box
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// The coherence rule of the "other" medication, shared by 001 and 004. It lives here and not in the
// validator because on update it is evaluated over the resulting state — what is stored merged with
// what arrives — and the validator only sees the body. It still answers 400: the problem is the
// combination of fields in the body, which is malformed input however it is checked.
//
// medicationCode does not take part in the rule, and that is not an oversight. In notificationEvent
// the equivalent prohibition made sense because esaviCode is the entry to a clinical master and
// declaring "other" means precisely that the master does not name it. Here there is no master: a
// medication missing from the form can perfectly well carry the code printed on its box, and
// forbidding it would lose data
const assertOtherMedicationRule = (
    isOtherMedication: boolean | null | undefined,
    otherMedicationText: string | null | undefined,
    op: string,
    lang: string
) => {
    const text = normalizeText(otherMedicationText);

    if( isOtherMedication === true ) {
        if( !text ) {
            throw new AppError(
                getMessage('notificationMedication.otherTextRequired', lang),
                400,
                `NOTIFMED_${ op }_OTHER_TEXT_REQUIRED`
            );
        }
        return;
    }

    if( text ) {
        throw new AppError(
            getMessage('notificationMedication.otherTextNotAllowed', lang),
            400,
            `NOTIFMED_${ op }_OTHER_TEXT_NOT_ALLOWED`
        );
    }
}

// Each item must exist, be active and belong to its own catalog: any other catalogItem would be a
// valid UUID pointing at a meaningless form or route, and the ON DELETE RESTRICT of the DDL does
// not prevent any of that — it only protects the deletion. The pattern is the one of
// nonSevereNotification.service.ts:191, copied and not extracted to a shared helper: the signature
// would have to absorb the AppError code, the i18n key and the op, and this spec would end up
// touching that service.
//
// An unseeded catalog makes every key of its kind fall here, which is the deployment precondition
// the spec declares
const assertCatalogItemIsValid = async (
    catalogItemId: string,
    catalogTypeCode: string,
    messageKey: string,
    errorCode: string,
    lang: string
) => {
    const catalogItem = await CatalogItem.findOne({
        where: { catalogItemId, isActive: true },
        attributes: ['catalogItemId'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: catalogTypeCode },
            attributes: []
        }]
    });
    if( !catalogItem ) {
        throw new AppError(getMessage(messageKey, lang), 404, errorCode);
    }
}

// The two catalog guards of 001 and 004, run only for the keys that arrive with a non null value:
// both columns are nullable in the DDL, and a notifier may know what the patient was taking without
// knowing in which form or by which route
const assertCatalogItemsAreValid = async (
    pharmaceuticalFormItemId: string | null | undefined,
    administrationRouteItemId: string | null | undefined,
    op: string,
    lang: string
) => {
    if( pharmaceuticalFormItemId ) {
        await assertCatalogItemIsValid(
            pharmaceuticalFormItemId,
            PHARMACEUTICAL_FORM_CATALOG_CODE,
            'notificationMedication.pharmaceuticalFormNotFound',
            `NOTIFMED_${ op }_PHARMACEUTICAL_FORM_NOT_FOUND`,
            lang
        );
    }

    if( administrationRouteItemId ) {
        await assertCatalogItemIsValid(
            administrationRouteItemId,
            ADMINISTRATION_ROUTE_CATALOG_CODE,
            'notificationMedication.administrationRouteNotFound',
            `NOTIFMED_${ op }_ADMINISTRATION_ROUTE_NOT_FOUND`,
            lang
        );
    }
}

// Create Notification Medication Service
// Code: ESAVI-NOTIFMED-001
// No transaction of its own, unlike the 001 of notificationEvent: nothing is written outside this
// table — there is no master to resolve against and no field is derived — so the create is a single
// statement and the implicit transaction of Sequelize is enough
const createNotificationMedicationService = async (
    data: CreateNotificationMedicationInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    await assertNotificationIsValid(data.notificationId, '001', lang);

    // On create the body is the whole resulting state, so the rule is evaluated over it directly
    assertOtherMedicationRule(data.isOtherMedication, data.otherMedicationText, '001', lang);

    await assertCatalogItemsAreValid(
        data.pharmaceuticalFormItemId,
        data.administrationRouteItemId,
        '001',
        lang
    );

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-NOTIFMED-001',
        detail: 'Notification medication created by service'
    };

    // sortOrder is deliberately absent from the create: leaving the column out of the INSERT is
    // what lets TRG_notificationMedication_setSortOrder assign it, under the advisory lock that
    // keeps two concurrent inserts from colliding. Sending an explicit 0 would work by accident,
    // not by contract
    const created = await NotificationMedication.create({
        notificationId: data.notificationId,
        medicationName: toTitleCase(data.medicationName.trim()),
        medicationCode: normalizeText(data.medicationCode),
        dose: normalizeText(data.dose),
        pharmaceuticalFormItemId: data.pharmaceuticalFormItemId ?? null,
        administrationRouteItemId: data.administrationRouteItemId ?? null,
        startDate: data.startDate ?? null,
        isOtherMedication: data.isOtherMedication ?? false,
        otherMedicationText: normalizeText(data.otherMedicationText),
        isActive: data.isActive ?? true,
        appDetails: [newEntry]
    }, { fields: CREATE_FIELDS });

    // Re-read so the response carries the two resolved catalog items and the sortOrder the trigger
    // assigned, which the create instance does not know
    const notificationMedication = await findNotificationMedicationWithRelations(created.medicationId, true);
    return notificationMedication ? toNotificationMedicationResponse(notificationMedication) : null;
}

// Get Active Notification Medications By Notification Service
// Code: ESAVI-NOTIFMED-002A
// The listing is entered by the foreign key and never by /: a medication does not exist without its
// notification, and a global listing of medications has no reader.
//
// The header guard is the inherited visibility applied to a collection: a retired notification
// answers 404 instead of an empty page, because an empty page would say "this notification has no
// medications" to somebody who is simply not allowed to see them.
//
// Ordered by sortOrder ascending, which is the whole point of the column, and with no filter by
// isOtherMedication, the two catalog keys, startDate or text — those are out of the scope of this
// spec
const getNotificationMedicationsByNotificationService = async (
    notificationId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await assertNotificationIsVisible(notificationId, '002A', lang, canViewInactive);

    const notificationMedications = await NotificationMedication.findAndCountAll({
        where: { notificationId, isActive: true },
        include: [PHARMACEUTICAL_FORM_INCLUDE, ADMINISTRATION_ROUTE_INCLUDE],
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });

    return {
        count: notificationMedications.count,
        rows: notificationMedications.rows.map(toNotificationMedicationResponse)
    };
}

// Get All Notification Medications By Notification Service - For Admin
// Code: ESAVI-NOTIFMED-002B
// The same listing as 002A without the isActive filter: it is the only door to a medication that
// was retired, and therefore the entry point of whoever is going to reactivate or purge it.
// paranoid: false is declarative here — the model is not paranoid, so deletedAt is a plain column
// and no scope would hide the sealed rows — and it is written for the same reason
// entityActivation.service.ts:21 writes it: the intent is to see everything, including what a 005A
// sealed
const getAllNotificationMedicationsByNotificationService = async (
    notificationId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await assertNotificationIsVisible(notificationId, '002B', lang, canViewInactive);

    const notificationMedications = await NotificationMedication.findAndCountAll({
        where: { notificationId },
        include: [PHARMACEUTICAL_FORM_INCLUDE, ADMINISTRATION_ROUTE_INCLUDE],
        order: [['sortOrder', 'ASC']],
        paranoid: false,
        limit,
        offset
    });

    return {
        count: notificationMedications.count,
        rows: notificationMedications.rows.map(toNotificationMedicationResponse)
    };
}

// Get Notification Medication By ID Service
// Code: ESAVI-NOTIFMED-003
// Two filters, and the second one is the inherited visibility: the medication must exist and be
// active, and its notification must be active too, unless canViewInactive says otherwise — today
// SUPERADMIN. The three failures answer the same 404 without distinguishing, because telling them
// apart would confirm to a USER that a medication exists under a notification it is not allowed to
// see
const getNotificationMedicationByIdService = async (id: string, lang: string, canViewInactive: boolean = false) => {
    const notificationMedication = await findNotificationMedicationWithRelations(id, canViewInactive);
    if( !notificationMedication ) {
        throw new AppError(getMessage('notificationMedication.notFound', lang), 404, 'NOTIFMED_003_NOT_FOUND');
    }
    return toNotificationMedicationResponse(notificationMedication);
}

export {
    createNotificationMedicationService,
    getNotificationMedicationsByNotificationService,
    getAllNotificationMedicationsByNotificationService,
    getNotificationMedicationByIdService
};
