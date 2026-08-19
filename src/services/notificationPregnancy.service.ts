import { CatalogItem, EsaviCase, Notification, NotificationPregnancy, Patient, SystemConfig } from '../models';
import { AppError, esaviLog, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateNotificationPregnancyInput } from '../types';
import {
    GESTATION_MAX_DAYS,
    GESTATION_MIN_DAYS,
    PREGNANCY_FEMALE_SEX_ITEM_CONFIG_CODE,
    PREGNANCY_FEMALE_SEX_ITEM_CONFIG_SCOPE
} from '../constants/notification.constants';

// The shape systemConfig stores a UUID under: valueType 'string' keeps it as a plain JSON string in
// the jsonb column, so what comes back from the driver is a JavaScript string and not an object
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The parent, included on every read to implement the inherited visibility. A single hop and not
// two: notificationPregnancy hangs straight from the header, so the chain notificationDiluent
// introduced does not apply here and composing it anyway would add a join that protects nothing.
//
// The notification never reaches the response: whoever needs it enters through ESAVI-NOTIFCN-003
const NOTIFICATION_INCLUDE = {
    model: Notification,
    as: 'notification',
    attributes: ['notificationId', 'isActive']
};

// sysDetails is trigger metadata and never leaves the service. The parent is dropped here after
// having done its job in the query, and nothing is resolved or nested: the only foreign key is
// notificationId and it travels raw, which is also what lets a PUT resend the response of its GET
// and find the key where it left it
const toNotificationPregnancyResponse = (notificationPregnancy: NotificationPregnancy) => {
    const plain = notificationPregnancy.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;
    delete plain.notification;

    return plain;
}

// The free text is normalized on write with trim, and a text that is blank after trimming is no text
// at all. It does not go through toTitleCase: notes is prose the notifier wrote, not a name.
//
// This is the fifth copy of this helper in the repository. Extracting it is overdue since F24 §7 and
// has its own spec pending, because doing it here would drag four foreign services into a CRUD
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// The notification must exist and be active. There is no filter by notificationType, deliberately
// deviating from severeNotification: that table *is* the detail of a severe notification and its
// name says so, while a pregnancy matters just as much in a non severe one, and the DDL declares no
// restriction of type.
//
// The include walks three hops — notification -> case -> patient — because the female sex rule of
// ESAVI-NOTIFPRG-001 needs patient.sexItemId, and reading it in the very query that validates the
// parent means the rule costs no second read. Nothing of this ever reaches the response
const findValidNotification = async (notificationId: string, op: string, lang: string) => {
    const notification = await Notification.findOne({
        where: { notificationId, isActive: true },
        attributes: ['notificationId'],
        include: [{
            model: EsaviCase,
            as: 'case',
            attributes: ['caseId'],
            include: [{
                model: Patient,
                as: 'patient',
                attributes: ['patientId', 'sexItemId']
            }]
        }]
    });
    if( !notification ) {
        throw new AppError(
            getMessage('notificationPregnancy.notificationNotFound', lang),
            404,
            `NOTIFPRG_${ op }_NOTIFICATION_NOT_FOUND`
        );
    }
    return notification;
}

// The one to one guard of the create, and the piece of this entity that most easily gets
// implemented wrong. UQ_notificationPregnancy_notification is a plain column constraint: it carries
// no WHERE "deletedAt" IS NULL, unlike the partial index notificationDiluent uses, so a withdrawn
// row keeps occupying the slot and no other pregnancy can be created for that notification while it
// exists.
//
// paranoid: false is what makes that true in the application too. Checking without it would answer
// 201 over a deactivated row and let Postgres raise a 23505 the client never asked for, which is
// lying about what is going to happen. The way back is ESAVI-NOTIFPRG-005B, and the i18n message
// names it.
//
// The check lives here and not as unique: true in the model because Sequelize does not verify unique
// before the INSERT: declaring it would only document what the database already enforces, while the
// 409 still has to be produced by hand
const assertNoExistingPregnancy = async (notificationId: string, op: string, lang: string) => {
    const existing = await NotificationPregnancy.findOne({
        where: { notificationId },
        attributes: ['pregnancyId'],
        paranoid: false
    });
    if( existing ) {
        throw new AppError(
            getMessage('notificationPregnancy.alreadyExists', lang),
            409,
            `NOTIFPRG_${ op }_ALREADY_EXISTS`
        );
    }
}

// The 500 of the female sex rule, with a line in the log naming the actual cause. The five causes
// share one i18n key on purpose: telling them apart is useless to the notifier, and whoever
// diagnoses them reads this log
const sexConfigMissing = (op: string, lang: string, cause: string) => {
    esaviLog(
        `ESAVI-NOTIFPRG-${ op }: The systemConfig row ${ PREGNANCY_FEMALE_SEX_ITEM_CONFIG_CODE } / ` +
        `${ PREGNANCY_FEMALE_SEX_ITEM_CONFIG_SCOPE } is not usable: ${ cause }`,
        'error'
    );
    return new AppError(
        getMessage('notificationPregnancy.sexConfigMissing', lang),
        500,
        `NOTIFPRG_${ op }_SEX_CONFIG_MISSING`
    );
}

// The female sex configuration, read straight from the model and never through the read-by-code
// service of ESAVI-SYSCONF-006. Reusing that service looks like the right thing and is not: it masks
// the value for anything below SUPERADMIN — and this create runs as USER — and it throws a 404
// carrying the code of another entity, which would reach the notifier as if the pregnancy did not
// exist. A service that exists for an HTTP read is not the way into an internal one.
//
// The code and the scope arrive already in constant case from the constants, which is the form
// systemConfig stores them in after its own toConstantCase, so nothing is normalized here.
//
// Five deviations from the declared contract, all of them 500 and none of them 400. It is a
// deployment configuration failure and the notifier cannot fix it: answering 400 would send them
// looking for the error in their own form, where it is not. The row must exist, be active, declare
// valueType 'string', not be encrypted, and hold the UUID of a catalogItem that exists.
//
// isEncrypted is caught explicitly, and it is the one that matters most. systemConfig stores an
// encrypted value wrapped as { "enc": "<ciphertext>" }: such a row does not fail, it simply never
// matches any sexItemId, so without this guard every female patient would get a 400
// PATIENT_NOT_FEMALE — a deployment error disguised as a notifier error, and the only one of the five
// that would produce a plausible answer instead of an error. Decrypting it is not the way out either:
// a catalogItemId is not a secret, and accepting the encrypted row would normalize a misdeclared
// configuration and make the rule start rejecting female patients the day the crypto key changes
const resolveFemaleSexItemId = async (op: string, lang: string): Promise<string> => {
    const config = await SystemConfig.findOne({
        where: {
            code: PREGNANCY_FEMALE_SEX_ITEM_CONFIG_CODE,
            scope: PREGNANCY_FEMALE_SEX_ITEM_CONFIG_SCOPE,
            isActive: true
        },
        attributes: ['value', 'valueType', 'isEncrypted']
    });

    // Absent and inactive collapse into one branch: the row that is not usable is not usable, and
    // the log line says which of the two it was as far as this query can tell
    if( !config ) throw sexConfigMissing(op, lang, 'the row is absent or inactive');

    if( config.isEncrypted ) throw sexConfigMissing(op, lang, 'the row is marked isEncrypted');

    if( config.valueType !== 'string' ) {
        throw sexConfigMissing(op, lang, `valueType is '${ config.valueType }' instead of 'string'`);
    }

    const value = config.value;
    if( typeof value !== 'string' || !UUID_PATTERN.test(value) ) {
        throw sexConfigMissing(op, lang, 'the value is not a UUID');
    }

    // The catalogItem is not filtered by isActive: an item retired after being configured still names
    // the sex it always named, and what this guard rules out is a value pointing at nothing
    const catalogItem = await CatalogItem.findOne({
        where: { catalogItemId: value },
        attributes: ['catalogItemId']
    });
    if( !catalogItem ) throw sexConfigMissing(op, lang, 'the value points to a catalogItem that does not exist');

    return value;
}

// The female sex rule, and it runs only in ESAVI-NOTIFPRG-001. A pregnancy registered on a male
// patient is a capture error with clinical consequences, not a tolerable oddity.
//
// A null sexItemId does not block. An unknown sex is no proof that there is no pregnancy, and
// blocking it would lose the whole case over a demographic field that can be completed later.
//
// The patient arrives in the include the parent guard already walked, so the rule costs no second
// query — and there is no read of the Patient model anywhere in this service
const assertPatientMayBePregnant = async (
    sexItemId: string | null | undefined,
    op: string,
    lang: string
) => {
    const femaleSexItemId = await resolveFemaleSexItemId(op, lang);

    if( !sexItemId ) return;

    if( sexItemId !== femaleSexItemId ) {
        throw new AppError(
            getMessage('notificationPregnancy.patientNotFemale', lang),
            400,
            `NOTIFPRG_${ op }_PATIENT_NOT_FEMALE`
        );
    }
}

// The gestational range rule, shared by 001 and 004: Naegele with a +/- 14 day tolerance, which is
// 38 to 42 weeks. A probable delivery date outside that window with respect to the last menstruation
// is almost always a capture error or a date conversion gone wrong.
//
// Both bounds are inclusive, and that is not a detail: a pregnancy landing exactly on either limit
// is a valid one, and implementing this with exclusive bounds would reject the two ends of the
// normal range. The limits themselves live in notification.constants.ts, named, because they are
// clinical values someone will want to adjust.
//
// A single error covers the case of a delivery date *earlier* than the menstruation too. Splitting
// it in two messages gives the client nothing more to act on: what it needs to know is that the two
// dates do not add up.
//
// It does not apply unless both dates are present. Both are nullable and a pregnancy with only one
// known date is a legitimate record. The values are cut to their first ten characters, so an ISO
// 8601 string with time compares as the calendar date it denotes.
//
// On update it is evaluated over the resulting state, never over the body, which is why it takes the
// two dates as arguments instead of reading them from the input
const assertGestationRangeIsCoherent = (
    lastMenstruationDate: string | null | undefined,
    probableDeliveryDate: string | null | undefined,
    op: string,
    lang: string
) => {
    if( !lastMenstruationDate || !probableDeliveryDate ) return;

    const start = Date.parse(`${ lastMenstruationDate.slice(0, 10) }T00:00:00Z`);
    const end = Date.parse(`${ probableDeliveryDate.slice(0, 10) }T00:00:00Z`);
    const days = ( end - start ) / 86400000;

    if( days < GESTATION_MIN_DAYS || days > GESTATION_MAX_DAYS ) {
        throw new AppError(
            getMessage('notificationPregnancy.deliveryDateOutOfRange', lang, {
                min: GESTATION_MIN_DAYS,
                max: GESTATION_MAX_DAYS
            }),
            400,
            `NOTIFPRG_${ op }_DELIVERY_DATE_OUT_OF_RANGE`
        );
    }
}

// Create Notification Pregnancy Service
// Code: ESAVI-NOTIFPRG-001
// No transaction of its own: nothing is written outside this table, no field is derived and no
// master is resolved, so the create is a single statement and the implicit transaction of Sequelize
// is enough.
//
// No explicit field list either, unlike the four one to many satellites: this table has no
// trigger assigned ordering column, so there is nothing to keep out of the INSERT
const createNotificationPregnancyService = async (
    data: CreateNotificationPregnancyInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    const notification = await findValidNotification(data.notificationId, '001', lang);

    await assertNoExistingPregnancy(data.notificationId, '001', lang);

    // The sex came back in the same query that validated the parent, three hops down, so the rule
    // costs no second read
    await assertPatientMayBePregnant(notification.case?.patient?.sexItemId, '001', lang);

    // On create the body is the whole resulting state, so the rule is evaluated over it directly
    assertGestationRangeIsCoherent(data.lastMenstruationDate, data.probableDeliveryDate, '001', lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-NOTIFPRG-001',
        detail: 'Notification pregnancy created by service'
    };

    // wasPregnantAtVaccination arrives guaranteed by the validator, which demands the answer and not
    // a particular content: NO, UNKNOWN and NO_ANSWER are all valid values here
    const created = await NotificationPregnancy.create({
        notificationId: data.notificationId,
        wasPregnantAtVaccination: data.wasPregnantAtVaccination,
        wasPregnantAtEsavi: data.wasPregnantAtEsavi ?? null,
        lastMenstruationDate: data.lastMenstruationDate ?? null,
        probableDeliveryDate: data.probableDeliveryDate ?? null,
        hasComplications: data.hasComplications ?? null,
        notes: normalizeText(data.notes),
        isActive: data.isActive ?? true,
        appDetails: [newEntry]
    });

    // Re-read so the response carries what the database wrote — createdAt and the sysDetails the
    // trigger sealed — which the create instance does not know
    const notificationPregnancy = await NotificationPregnancy.findByPk(created.pregnancyId);
    return notificationPregnancy ? toNotificationPregnancyResponse(notificationPregnancy) : null;
}

// The read every operation entered by pregnancyId shares. The parent include is mandatory and not
// decorative: with required: true and the isActive filter it is what implements the inherited
// visibility, so a pregnancy hanging from a withdrawn notification simply does not come back.
//
// The two conditions — the row itself being active, and its notification being active — are
// evaluated the same way and neither takes precedence: it is enough that one of them fails for the
// caller to get a 404, and canViewInactive relaxes both at once
const findNotificationPregnancy = async (id: string, includeInactive: boolean = false) => {
    return await NotificationPregnancy.findOne({
        where: includeInactive ? { pregnancyId: id } : { pregnancyId: id, isActive: true },
        include: [{
            ...NOTIFICATION_INCLUDE,
            required: true,
            where: includeInactive ? {} : { isActive: true }
        }]
    });
}

// Get Notification Pregnancy By ID Service
// Code: ESAVI-NOTIFPRG-003
const getNotificationPregnancyByIdService = async (
    id: string,
    lang: string,
    canViewInactive: boolean = false
) => {
    const notificationPregnancy = await findNotificationPregnancy(id, canViewInactive);
    if( !notificationPregnancy ) {
        throw new AppError(
            getMessage('notificationPregnancy.notFound', lang),
            404,
            'NOTIFPRG_003_NOT_FOUND'
        );
    }
    return toNotificationPregnancyResponse(notificationPregnancy);
}

// The inherited visibility applied to the entry by notificationId, where the parent is not the
// target of the write but the gate to the row. A withdrawn notification answers 404 for USER and
// ADMIN, and comes back for whoever may see inactive rows, today SUPERADMIN.
//
// It does not walk down to the patient: the female sex rule runs only in the create, and composing
// the three hop include here would join two tables nothing reads
const assertNotificationIsVisible = async (
    notificationId: string,
    op: string,
    lang: string,
    canViewInactive: boolean = false
) => {
    const notification = await Notification.findOne({
        where: canViewInactive ? { notificationId } : { notificationId, isActive: true },
        attributes: ['notificationId']
    });
    if( !notification ) {
        throw new AppError(
            getMessage('notificationPregnancy.notificationNotFound', lang),
            404,
            `NOTIFPRG_${ op }_NOTIFICATION_NOT_FOUND`
        );
    }
}

// Get Notification Pregnancy By Notification Service
// Code: ESAVI-NOTIFPRG-006
// It returns a single object and not a { count, rows }: the relation is one to one, so there is no
// counted read here, no pagination and no order. A listing of at most one row has no reader.
//
// The two 404 carry distinct codes on purpose. "the notification does not exist or is withdrawn" and
// "this notification has no pregnancy" are different answers for the client: the first one is a dead
// end, the second one is an invitation to create the row
const getNotificationPregnancyByNotificationService = async (
    notificationId: string,
    lang: string,
    canViewInactive: boolean = false
) => {
    await assertNotificationIsVisible(notificationId, '006', lang, canViewInactive);

    const notificationPregnancy = await NotificationPregnancy.findOne({
        where: canViewInactive ? { notificationId } : { notificationId, isActive: true }
    });
    if( !notificationPregnancy ) {
        throw new AppError(
            getMessage('notificationPregnancy.notFound', lang),
            404,
            'NOTIFPRG_006_NOT_FOUND'
        );
    }
    return toNotificationPregnancyResponse(notificationPregnancy);
}

export {
    createNotificationPregnancyService,
    getNotificationPregnancyByIdService,
    getNotificationPregnancyByNotificationService
};
