import { InferAttributes, Op, Transaction } from 'sequelize';
import { sequelize } from '../database/connection';
import { DiluentCatalog, Notification, NotificationDiluent, NotificationVaccine } from '../models';
import { AppError, buildDifferentialUpdate, getMessage } from '../helpers';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { purgeEntityService } from './common/entityPurge.service';
import { AppDetails, AuthUser, CreateNotificationDiluentInput } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

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

// The same read as above without the master include, which is what ESAVI-NOTIFDIL-004 needs: the
// update compares the raw foreign key, not the resolved object, and the include would only add a
// join to a query whose instance is about to be written. The parent chain stays, so the inherited
// visibility is checked in the same query the update instance comes from, and it carries
// vaccinationDate because the temporal coherence rule needs it
const findNotificationDiluentRow = async (id: string, includeInactive: boolean = false, transaction?: Transaction) => {
    return await NotificationDiluent.findOne({
        where: includeInactive ? { diluentId: id } : { diluentId: id, isActive: true },
        include: [{
            ...VACCINE_INCLUDE,
            required: true,
            where: includeInactive ? {} : { isActive: true },
            include: [{
                ...VACCINE_INCLUDE.include[0],
                required: true,
                where: includeInactive ? {} : { isActive: true }
            }]
        }],
        transaction
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

// The same check as above, relaxed by canViewInactive: the inherited visibility applied to the
// listings, where the parent is not the target of the write but the gate to the collection. A
// retired vaccine — or one whose notification was retired — answers 404 for USER and ADMIN, and
// comes back for whoever may see inactive rows, today SUPERADMIN.
//
// The two levels are checked here too. Settling for the vaccine alone would be cheaper by one join
// and would leave visible the diluents of a notification that was withdrawn whole, breaking the
// transitivity of the rule exactly where the graph gets deep.
//
// It does not read vaccinationDate: no listing needs it, and it is only used by the two writes
const assertVaccineIsVisible = async (
    vaccineId: string,
    op: string,
    lang: string,
    canViewInactive: boolean = false
) => {
    const vaccine = await NotificationVaccine.findOne({
        where: canViewInactive ? { vaccineId } : { vaccineId, isActive: true },
        attributes: ['vaccineId'],
        include: [{
            model: Notification,
            as: 'notification',
            attributes: ['notificationId'],
            required: true,
            where: canViewInactive ? {} : { isActive: true }
        }]
    });
    if( !vaccine ) {
        throw new AppError(
            getMessage('notificationDiluent.vaccineNotFound', lang),
            404,
            `NOTIFDIL_${ op }_VACCINE_NOT_FOUND`
        );
    }
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

// The temporal coherence rule, shared by 001 and 004. A vial is reconstituted before, or the very
// same day, the vaccine is administered — reconstituting it after the shot is an impossible datum,
// not a rare case.
//
// It is a single hop, against the direct parent, and it deliberately does not reach esaviCase. If
// vaccinationDate is already coherent with eventDate by the rule of F22, and reconstitutionDate is
// coherent with vaccinationDate, transitivity does the rest: checking against the case here would
// duplicate an existing validation and tie this entity to a table three hops up.
//
// The same day is valid, and here it is the normal case rather than a tolerated exception: a vial is
// reconstituted minutes before being administered, and requiring strictly earlier would block the
// ordinary record.
//
// It compares only the dates, never the times. notificationVaccine.vaccinationDate is a `date` and
// there is no hour to compare against, even though the vaccine does carry a vaccinationTime.
//
// It does not apply when either date is missing. Both values are cut to their first ten characters,
// so an ISO 8601 string with time compares as the calendar date it denotes
const assertReconstitutionDateIsCoherent = (
    reconstitutionDate: string | null | undefined,
    vaccinationDate: string | null | undefined,
    op: string,
    lang: string
) => {
    if( !reconstitutionDate || !vaccinationDate ) return;

    if( reconstitutionDate.slice(0, 10) > vaccinationDate.slice(0, 10) ) {
        throw new AppError(
            getMessage('notificationDiluent.reconstitutionAfterVaccination', lang),
            400,
            `NOTIFDIL_${ op }_RECONSTITUTION_AFTER_VACCINATION`
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
    const vaccine = await findValidVaccine(data.vaccineId, '001', lang);

    // On create the body is the whole resulting state, so the guards are evaluated over it directly
    assertMinimumContent(data.diluentCatalogId, data.diluentName, '001', lang);

    await assertDiluentCatalogIsValid(data.diluentCatalogId, '001', lang);

    // The vaccinationDate came back in the same query that validated the parent chain, so the rule
    // costs no second read
    assertReconstitutionDateIsCoherent(data.reconstitutionDate, vaccine.vaccinationDate, '001', lang);

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

// Get Active Notification Diluents By Vaccine Service
// Code: ESAVI-NOTIFDIL-002A
// The listing is entered by the foreign key and never by /: a notified diluent does not exist
// without its vaccine, and a global listing has no reader. It is not entered by the case or by the
// notification either — that would flatten a two level fan out and mix rows of different vaccines
// under a sortOrder that is relative to each of them.
//
// The parent guard is the inherited visibility applied to a collection: a retired vaccine answers
// 404 instead of an empty page, because an empty page would say "this vaccine has no diluents" to
// somebody who is simply not allowed to see them.
//
// Ordered by sortOrder ascending, which is the whole point of the column, and with no filter by
// diluentCatalogId, batchNumber, dates or text — those are out of the scope of this spec
const getNotificationDiluentsByVaccineService = async (
    vaccineId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await assertVaccineIsVisible(vaccineId, '002A', lang, canViewInactive);

    const notificationDiluents = await NotificationDiluent.findAndCountAll({
        where: { vaccineId, isActive: true },
        include: [DILUENT_CATALOG_INCLUDE],
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });

    return {
        count: notificationDiluents.count,
        rows: notificationDiluents.rows.map(toNotificationDiluentResponse)
    };
}

// Get All Notification Diluents By Vaccine Service - For Admin
// Code: ESAVI-NOTIFDIL-002B
// The same listing as 002A without the isActive filter: it is the only door to a diluent that was
// retired, and therefore the entry point of whoever is going to reactivate or purge it.
// paranoid: false is declarative here — the model is not paranoid, so deletedAt is a plain column
// and no scope would hide the sealed rows — and it is written for the same reason
// entityActivation.service.ts:21 writes it: the intent is to see everything, including what a 005A
// sealed
const getAllNotificationDiluentsByVaccineService = async (
    vaccineId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await assertVaccineIsVisible(vaccineId, '002B', lang, canViewInactive);

    const notificationDiluents = await NotificationDiluent.findAndCountAll({
        where: { vaccineId },
        include: [DILUENT_CATALOG_INCLUDE],
        order: [['sortOrder', 'ASC']],
        paranoid: false,
        limit,
        offset
    });

    return {
        count: notificationDiluents.count,
        rows: notificationDiluents.rows.map(toNotificationDiluentResponse)
    };
}

// Get Notification Diluent By ID Service
// Code: ESAVI-NOTIFDIL-003
// Three filters, and two of them are the inherited visibility in chain: the diluent must exist and
// be active, its vaccine must be active, and the notification that vaccine hangs from must be active
// too — unless canViewInactive says otherwise, today SUPERADMIN.
//
// This is the first entity of the repository whose visibility is two hops instead of one, and the
// three conditions are evaluated the same way, with no priority among them: it is enough that one
// fails, so there is nothing to decide when two of them fail at once. The three failures answer the
// same 404 without distinguishing, because telling them apart would confirm to a USER that a diluent
// exists under a vaccine it is not allowed to see
const getNotificationDiluentByIdService = async (id: string, lang: string, canViewInactive: boolean = false) => {
    const notificationDiluent = await findNotificationDiluentWithRelations(id, canViewInactive);
    if( !notificationDiluent ) {
        throw new AppError(getMessage('notificationDiluent.notFound', lang), 404, 'NOTIFDIL_003_NOT_FOUND');
    }
    return toNotificationDiluentResponse(notificationDiluent);
}

// Update Notification Diluent Service
// Code: ESAVI-NOTIFDIL-004
// vaccineId and sortOrder are ignored whether or not they arrive in the body, and neither answers
// 400: the first one is immutable — moving a diluent to another vaccine is not updating it, it is
// creating a different one — and the second one is governed by the database. Answering 400 for a
// field a client resends whole from a GET is hostile for no reason
const updateNotificationDiluentService = async (
    id: string,
    data: Partial<CreateNotificationDiluentInput>,
    authUser: AuthUser | undefined,
    lang: string,
    canViewInactive: boolean = false
) => {
    const transaction = await sequelize.transaction();

    try {
        const notificationDiluent = await findNotificationDiluentRow(id, canViewInactive, transaction);
        if( !notificationDiluent ) {
            throw new AppError(getMessage('notificationDiluent.notFound', lang), 404, 'NOTIFDIL_004_NOT_FOUND');
        }

        // The whole row, never narrowed: that is the precondition of buildDifferentialUpdate, and an
        // instance read with a narrowed `attributes` reads back undefined for what it left out, so
        // every comparison would count as a change
        const stored = notificationDiluent.get({ plain: true }) as Record<string, unknown>;

        // The guards are evaluated over the resulting state and not over the body: otherwise a PUT
        // clearing diluentName over a row with no master key would empty the row, and a PUT moving
        // only the reconstitution date would never be checked against the vaccine
        const resultingCatalogId = data.diluentCatalogId !== undefined
            ? ( data.diluentCatalogId ?? null )
            : ( stored.diluentCatalogId as string | null );
        const resultingDiluentName = data.diluentName !== undefined
            ? normalizeText(data.diluentName)
            : ( stored.diluentName as string | null );
        const resultingReconstitutionDate = data.reconstitutionDate !== undefined
            ? ( data.reconstitutionDate ?? null )
            : ( stored.reconstitutionDate as string | null );

        assertMinimumContent(resultingCatalogId, resultingDiluentName, '004', lang);

        // Before the diff and independently of it: a PUT carrying a retired master entry answers 404
        // even when no other field changes. Only a key arriving with a non null value is checked —
        // an explicit null clears the column and validates nothing
        await assertDiluentCatalogIsValid(data.diluentCatalogId, '004', lang);

        assertReconstitutionDateIsCoherent(
            resultingReconstitutionDate,
            notificationDiluent.vaccine?.vaccinationDate,
            '004',
            lang
        );

        // vaccineId, sortOrder and isActive are deliberately absent: the first two are immutable and
        // the state moves through 005A and 005B. No field is derived — the two free texts are the
        // client's copy of what was transcribed from the vial and are never filled in from the
        // master — so the seven candidates are compared against what is stored and nothing is
        // computed
        const candidates: Record<string, unknown> = {
            diluentCatalogId: data.diluentCatalogId !== undefined
                ? ( data.diluentCatalogId ?? null )
                : undefined,
            // Trimmed and never title cased, or a PUT resending the GET would rewrite what the
            // notifier read on the vial
            batchNumber: data.batchNumber !== undefined ? normalizeText(data.batchNumber) : undefined,
            // DATEONLY: the helper compares it with slice(0, 10)
            expirationDate: data.expirationDate !== undefined ? ( data.expirationDate ?? null ) : undefined,
            reconstitutionDate: data.reconstitutionDate !== undefined ? ( data.reconstitutionDate ?? null ) : undefined,
            // Padded to HH:MM:SS before comparing, or a PUT sending '09:15' over a stored '09:15:00'
            // would count as a change for a value Postgres would store identical
            reconstitutionTime: data.reconstitutionTime !== undefined ? normalizeTime(data.reconstitutionTime) : undefined,
            diluentName: data.diluentName !== undefined ? normalizeText(data.diluentName) : undefined,
            diluentCode: data.diluentCode !== undefined ? normalizeText(data.diluentCode) : undefined
        };

        // Nothing changed: no UPDATE, no updatedAt and no audit entry. It also spares the row the
        // sysDetails.version bump that TRG_notificationDiluent_setSysDetails fires on every write
        const objectToUpdate = buildDifferentialUpdate(stored, candidates);
        // Nothing to write: the transaction closes without an UPDATE and the row is re-read outside
        // it, exactly like the branch that did write
        if( Object.keys(objectToUpdate).length > 0 ) {
            // Written by hand so the service does not depend on a trigger for a column it owns: the
            // generic loop of esaviapp.sql drops TRG_<table>_setUpdatedAt and never creates it
            objectToUpdate.updatedAt = new Date();

            // The history is extended, never overwritten
            const currentAppDetails = Array.isArray(notificationDiluent.appDetails)
                ? notificationDiluent.appDetails
                : [];
            const newEntry: AppDetails = {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: 'ESAVI-NOTIFDIL-004',
                detail: 'Notification diluent updated by service'
            };
            await notificationDiluent.update({
                ...objectToUpdate,
                appDetails: [
                    ...currentAppDetails,
                    newEntry
                ]
            }, { transaction });
        }

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    const updated = await findNotificationDiluentWithRelations(id, true);
    return updated ? toNotificationDiluentResponse(updated) : null;
}

// The one piece of ESAVI-NOTIFDIL-005B that is not a clean delegation, and the reason this entity
// cannot hand its activation to setEntityActiveStatusService and be done with it. The problem and
// its solution are the ones F16 verified and F21 and F22 reconfirmed over the very same
// configuration, adopted here without being reasoned again.
//
// UQ_notificationDiluent_parent_sortOrder is a partial unique index over (vaccineId, sortOrder)
// WHERE deletedAt IS NULL (esaviapp.sql:1341-1343). A 005A seals deletedAt, so the number leaves
// both the index and the MAX the insert trigger computes, and a later create legitimately reuses it.
// The moment setEntityActiveStatusService:34 clears deletedAt, the reactivated row re-enters the
// index carrying a number another live row already holds, and the UPDATE dies with a constraint
// violation — a 500 for an operation that should answer 200.
//
// The fix is to move the number before touching deletedAt: while deletedAt is still sealed the row
// is outside the partial index, so this write is free. Inverting the two steps makes the index fail
// inside the helper's own UPDATE — the constraint is not deferrable and there would be no way to fix
// it afterwards.
//
// This is a write with an intention of its own over a field the client neither sent nor can send, so
// it does not go through buildDifferentialUpdate: it does not come from comparing an incoming value
// against the stored one, but from a constraint of the database.
//
// A missing row is left alone: the helper right after raises the 404. An already active row finds no
// collision either — the index guarantees no other live row shares its number — so nothing is
// written and the helper raises its 409 as usual
const reassignSortOrderOnCollision = async (id: string, transaction: Transaction) => {
    const notificationDiluent = await NotificationDiluent.findOne({
        where: { diluentId: id },
        paranoid: false,
        transaction
    });
    if( !notificationDiluent || notificationDiluent.deletedAt === null ) {
        return;
    }

    const collision = await NotificationDiluent.findOne({
        where: {
            vaccineId: notificationDiluent.vaccineId,
            sortOrder: notificationDiluent.sortOrder as number,
            deletedAt: null,
            diluentId: { [Op.ne]: id }
        },
        attributes: ['diluentId'],
        paranoid: false,
        transaction
    });
    if( !collision ) {
        return;
    }

    // The same count TRG_notificationDiluent_setSortOrder does on insert, so the reactivated diluent
    // reappears at the end of the list
    const highest = await NotificationDiluent.max<number, NotificationDiluent>('sortOrder', {
        where: { vaccineId: notificationDiluent.vaccineId, deletedAt: null },
        transaction
    });

    await notificationDiluent.update(
        { sortOrder: ( Number(highest) || 0 ) + 1 },
        { transaction, fields: ['sortOrder'] }
    );
}

// Set Notification Diluent Activation Service
// Code: ESAVI-NOTIFDIL-005A / ESAVI-NOTIFDIL-005B
// One service for the two operations, with the number computed as the rest of the repository does
// it. Neither is a differential update: they are state writes with an intent of their own, they
// record a fact even though no data column changes, and that is why they go through
// setEntityActiveStatusService and never through buildDifferentialUpdate.
//
// The 005A seals deletedAt, which frees the sortOrder from the partial unique index. That is correct
// and deliberate: the gap stays available for the next diluent.
//
// Neither operation is blocked by anything. notificationDiluent is a leaf of the graph: there are no
// children to query and no state to drag, in either direction. Deactivating a diluent touches
// nothing else, and the inherited visibility already resolves the reading side
const setNotificationDiluentActivationService = async (
    id: string,
    authUser: AuthUser | undefined,
    lang: string,
    isActive: boolean = true
) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        // Only on the way back: a 005A is what frees the number, so it never collides.
        // The reactivation revalidates nothing else — not the master, not the minimum content, not
        // the temporal coherence, not the state of the parent vaccine. Bringing a row back to life
        // is undoing a deactivation, not rewriting it, and this operation writes none of those
        // columns
        if( isActive ) {
            await reassignSortOrderOnCollision(id, transaction);
        }

        const notificationDiluent = await setEntityActiveStatusService({
            model: NotificationDiluent,
            where: { diluentId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('notificationDiluent.notFound', lang),
            notFoundCode: `NOTIFDIL_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`notificationDiluent.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `NOTIFDIL_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-NOTIFDIL-${ op }`,
                detail: `Notification diluent ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return notificationDiluent;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// Purging Notification Diluent Service - For SuperAdmin
// Code: ESAVI-NOTIFDIL-005C
// notificationDiluent is outside the preventPhysicalDelete loop of esaviapp.sql:1361-1375, so the
// row can really be destroyed.
//
// purgeEntityService serves as it is, with no modification: its canonical guard — the row must have
// been retired with a 005A first, 409 otherwise — applies over the row itself. The state of the
// vaccine and of the notification is deliberately not checked.
//
// And here is the difference with the 005C of notificationVaccine: this table is a leaf of the
// graph. Nothing references diluentId, so destroying a row drags no other one, there is no cascade
// to count and no ids to dump. Copying the raw query of F22 would produce a SELECT that always comes
// back empty, and the helper already writes the warn line with the destroyed row
const purgeNotificationDiluentService = async (id: string, authUser: AuthUser | undefined, lang: string) => {
    const transaction = await sequelize.transaction();
    try {
        await purgeEntityService({
            model: NotificationDiluent,
            where: { diluentId: id },
            transaction,
            operationCode: 'ESAVI-NOTIFDIL-005C',
            userId: authUser?.userId || 'undefined',
            notFoundMessage: getMessage('notificationDiluent.notFound', lang),
            notFoundCode: 'NOTIFDIL_005C_NOT_FOUND',
            stillActiveMessage: getMessage('notificationDiluent.stillActive', lang, { id }),
            stillActiveCode: 'NOTIFDIL_005C_STILL_ACTIVE'
        });
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createNotificationDiluentService,
    getAllNotificationDiluentsByVaccineService,
    getNotificationDiluentByIdService,
    getNotificationDiluentsByVaccineService,
    purgeNotificationDiluentService,
    setNotificationDiluentActivationService,
    updateNotificationDiluentService
};
