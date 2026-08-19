import { EsaviCase, Notification, NotificationPregnancy, Patient } from '../models';
import { AppError, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateNotificationPregnancyInput } from '../types';
import { GESTATION_MAX_DAYS, GESTATION_MIN_DAYS } from '../constants/notification.constants';

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
    await findValidNotification(data.notificationId, '001', lang);

    await assertNoExistingPregnancy(data.notificationId, '001', lang);

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

export {
    createNotificationPregnancyService
};
