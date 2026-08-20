import { InferAttributes } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, CatalogType, DiagnosticTerm, Notification, NotificationPregnancy, NotificationPregnancyComplication } from '../models';
import { AppError, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateNotificationPregnancyComplicationInput } from '../types';

// Code of the catalogType that groups the pregnancy complication types. Without this check any
// active catalogItem of the system would enter as a complication type. The three items the domain
// handles today — congenital anomalies, fetal or neonatal complications, complications of labour —
// are data of a particular installation and are deliberately not wired anywhere: what is validated
// is the membership of the catalogType, never the content.
// catalogType codes are stored in camelCase — catalogType.service.ts:12
const PREGNANCY_COMPLICATION_TYPE_CATALOG_CODE = 'pregnancyComplicationType';

// The columns the INSERT of ESAVI-PREGCOMP-001 writes, listed one by one so sortOrder stays out of
// it. Omitting the value is not enough: the column is allowNull: false and Sequelize runs its own
// notNull validation over every attribute of the create before reaching Postgres, so an unlisted
// sortOrder would be rejected in the application and
// TRG_notificationPregnancyComplication_setSortOrder would never get to assign it. Passing the
// field list is what makes the column absent from the statement. complicationId is out for the same
// reason it is out of the body: gen_random_uuid() writes it
const CREATE_FIELDS: (keyof InferAttributes<NotificationPregnancyComplication>)[] = [
    'pregnancyId',
    'diagnosticTermId',
    'complicationTypeItemId',
    'complicationRawName',
    'notes',
    'isActive',
    'appDetails'
];

// The columns every response carries, listed one by one instead of dropped afterwards. sysDetails
// is trigger metadata and never leaves the service, and the jsonb column this spec left out of
// scope is not named anywhere in this file — an explicit list is what keeps both out without having
// to mention them
const RESPONSE_ATTRIBUTES: (keyof InferAttributes<NotificationPregnancyComplication>)[] = [
    'complicationId',
    'pregnancyId',
    'diagnosticTermId',
    'complicationTypeItemId',
    'complicationRawName',
    'sortOrder',
    'notes',
    'isActive',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'appDetails'
];

// The parent chain, read on every operation to implement the inherited visibility. Two hops, as in
// notificationDiluent, but with a one to one first hop: UQ_notificationPregnancy_notification allows
// a single pregnancy per notification, so the fan out only opens at the second level. A perfectly
// active complication is invisible if its pregnancy was withdrawn, and also if the whole
// notification was.
//
// Neither the pregnancy nor the notification ever reaches the response: whoever needs them enters
// through ESAVI-NOTIFPRG-003 and ESAVI-NOTIFCN-003
const PREGNANCY_INCLUDE = {
    model: NotificationPregnancy,
    as: 'pregnancy',
    attributes: ['pregnancyId', 'isActive'],
    include: [{
        model: Notification,
        as: 'notification',
        attributes: ['notificationId', 'isActive']
    }]
};

// The resolved master term, with six fields and without metadata: that column carries the internal
// markers of the implicit resolution — autoCreated, reviewStatus — which are governance of the
// catalog and not data of the notification. It is the decision of F16, literal.
//
// The include does not filter by isActive, deliberately: a term retired after the record was written
// still says what the complication was coded as
const DIAGNOSTIC_TERM_INCLUDE = {
    model: DiagnosticTerm,
    as: 'diagnosticTerm',
    attributes: ['diagnosticTermId', 'source', 'code', 'name', 'termGroup', 'isActive']
};

// The complication type, narrowed to four fields. It always exists: the foreign key is mandatory on
// creation and the 004 does not let it be cleared
const COMPLICATION_TYPE_INCLUDE = {
    model: CatalogItem,
    as: 'complicationType',
    attributes: ['catalogItemId', 'code', 'name', 'isActive']
};

// The parent chain is dropped here after having done its job in the query, and the master term comes
// back as an explicit null when the complication was notified without a code, so a client does not
// have to tell "empty" from "absent".
//
// The name the client displays is complicationRawName ?? diagnosticTerm.name. There is no third
// field resolving it, and that is the simplification the DDL imposes: when complicationRawName is
// null the notifier wrote exactly what the master says
const toNotificationPregnancyComplicationResponse = (complication: NotificationPregnancyComplication) => {
    const plain = complication.toJSON() as Record<string, unknown>;
    delete plain.pregnancy;

    plain.diagnosticTerm = plain.diagnosticTerm ?? null;

    return plain;
}

// The pregnancy must exist and be active, and so must its notification: a retired pregnancy does not
// take a new complication, and neither does one hanging from a retired header. The two levels are
// checked in the same query with the nested include, which is why this is a single read and not two.
//
// The three reasons share code and message: telling them apart is of no use to the notifier, and
// distinguishing them would confirm to a USER that a pregnancy exists under a notification it is not
// allowed to see
const findValidPregnancy = async (pregnancyId: string, op: string, lang: string) => {
    const pregnancy = await NotificationPregnancy.findOne({
        where: { pregnancyId, isActive: true },
        attributes: ['pregnancyId'],
        include: [{
            model: Notification,
            as: 'notification',
            attributes: ['notificationId'],
            required: true,
            where: { isActive: true }
        }]
    });
    if( !pregnancy ) {
        throw new AppError(
            getMessage('notificationPregnancyComplication.pregnancyNotFound', lang),
            404,
            `PREGCOMP_${ op }_PREGNANCY_NOT_FOUND`
        );
    }
    return pregnancy;
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all. Neither goes through toTitleCase or toConstantCase: complicationName is the copy of
// what the notifier wrote and its only value is reproducing it, and the toConstantCase of the code
// is applied by resolveDiagnosticTermService, never by this service.
//
// This is the eighth copy of this helper in the repository. Extracting it is overdue since F24 §7
// and has its own spec pending, because doing it here would drag seven foreign services into a CRUD
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// The item must exist, be active and belong to the pregnancy complication type catalog: any other
// catalogItem would be a valid UUID pointing at a meaningless type. It is the double hop
// assertVaccinationSiteIsValid established, literal. An unseeded catalog makes every
// complicationTypeItemId fall here, which is the deployment precondition the spec declares.
//
// Three causes — it does not exist, it is inactive, it does not belong to the catalog — and a single
// error, because none of the three is actionable in a different way
const assertComplicationTypeIsValid = async (complicationTypeItemId: string, op: string, lang: string) => {
    const complicationType = await CatalogItem.findOne({
        where: { catalogItemId: complicationTypeItemId, isActive: true },
        attributes: ['catalogItemId'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: PREGNANCY_COMPLICATION_TYPE_CATALOG_CODE },
            attributes: []
        }]
    });
    if( !complicationType ) {
        throw new AppError(
            getMessage('notificationPregnancyComplication.complicationTypeNotFound', lang),
            404,
            `PREGCOMP_${ op }_COMPLICATION_TYPE_NOT_FOUND`
        );
    }
}

// The read every operation shares to build its response. The parent include is mandatory and not
// decorative: with required: true and the isActive filter over both levels it is what implements the
// inherited visibility, so a complication hanging from a retired pregnancy — or from a pregnancy
// whose notification was retired — simply does not come back
const findComplicationWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await NotificationPregnancyComplication.findOne({
        where: includeInactive ? { complicationId: id } : { complicationId: id, isActive: true },
        attributes: RESPONSE_ATTRIBUTES,
        include: [
            {
                ...PREGNANCY_INCLUDE,
                required: true,
                where: includeInactive ? {} : { isActive: true },
                include: [{
                    ...PREGNANCY_INCLUDE.include[0],
                    required: true,
                    where: includeInactive ? {} : { isActive: true }
                }]
            },
            DIAGNOSTIC_TERM_INCLUDE,
            COMPLICATION_TYPE_INCLUDE
        ]
    });
}

// Create Notification Pregnancy Complication Service
// Code: ESAVI-PREGCOMP-001
// Everything inside a single transaction, because the resolution against the clinical master may
// write in diagnosticTerm
const createNotificationPregnancyComplicationService = async (
    data: CreateNotificationPregnancyComplicationInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    const transaction = await sequelize.transaction();
    let createdId: string;

    try {
        await findValidPregnancy(data.pregnancyId, '001', lang);

        await assertComplicationTypeIsValid(data.complicationTypeItemId, '001', lang);

        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-PREGCOMP-001',
            detail: 'Notification pregnancy complication created by service'
        };

        // sortOrder is deliberately absent from the create: leaving the column out of the INSERT is
        // what lets TRG_notificationPregnancyComplication_setSortOrder assign it, under the advisory
        // lock that keeps two concurrent inserts from colliding. Sending an explicit 0 would work by
        // accident, not by contract
        const created = await NotificationPregnancyComplication.create({
            pregnancyId: data.pregnancyId,
            diagnosticTermId: null,
            complicationTypeItemId: data.complicationTypeItemId,
            complicationRawName: normalizeText(data.complicationName),
            notes: normalizeText(data.notes),
            isActive: data.isActive ?? true,
            appDetails: [newEntry]
        }, { transaction, fields: CREATE_FIELDS });

        createdId = created.complicationId;

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    // Re-read so the response carries the resolved master term, the complication type and the
    // sortOrder the trigger assigned, which the create instance does not know
    const complication = await findComplicationWithRelations(createdId, true);
    return complication ? toNotificationPregnancyComplicationResponse(complication) : null;
}

export {
    createNotificationPregnancyComplicationService
};
