import { InferAttributes, Op, Transaction, WhereOptions } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, EsaviCase, Investigation, InvestigationTeamMember } from '../models';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { purgeEntityService } from './common/entityPurge.service';
import { AppError, buildDifferentialUpdate, getMessage, normalizeName } from '../helpers';
import { AppDetails, AuthUser, CreateInvestigationTeamMemberInput } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The order of the three listings, and there is no createdAt DESC here: sortOrder is what the
// domain orders the investigating team by, and the whole reason the column exists. createdAt is
// the tie-breaker, and it only bites in 002B: the partial unique index keeps the live rows of one
// investigation from sharing a number, but two rows sealed by a 005A can. It never moves after the
// insert, unlike updatedAt, which would shuffle the list on every save
const LIST_ORDER: [string, string][] = [['sortOrder', 'ASC'], ['createdAt', 'ASC']];

// The columns the INSERT of ESAVI-INVTEAM-001 writes, listed one by one so sortOrder stays out of
// it. Omitting the value is not enough: the column is allowNull: false and Sequelize runs its own
// notNull validation over every attribute of the create before reaching Postgres, so an unlisted
// sortOrder would be rejected in the application and TRG_investigationTeamMember_setSortOrder would
// never get to assign it. Passing the field list is what makes the column absent from the
// statement. investigationTeamMemberId is out for the same reason it is out of the body:
// gen_random_uuid() writes it
const CREATE_FIELDS: (keyof InferAttributes<InvestigationTeamMember>)[] = [
    'investigationId',
    'fullName',
    'institutionName',
    'email',
    'phone',
    'notes',
    'isActive',
    'appDetails'
];

// The investigation travels in every response, listings included: it is what governs the visibility
// of the member, and hiding it would leave the client unable to explain why a record it read in a
// list answers 404 through 003. Its own sysDetails stays out, like the one of the member.
// status never comes back null, by the rule F28 imposed on that entity
const INVESTIGATION_INCLUDE = {
    model: Investigation,
    as: 'investigation',
    attributes: ['investigationId', 'isActive', 'investigationStartDate'],
    include: [
        {
            model: CatalogItem,
            as: 'status',
            attributes: ['catalogItemId', 'code', 'name']
        },
        {
            model: EsaviCase,
            as: 'case',
            attributes: ['caseId', 'caseCode', 'eventDate']
        }
    ]
};

// sysDetails is trigger metadata and never leaves the service. Everything else travels, sortOrder
// included: the client did not send it and cannot change it, but it is what explains the order the
// listings come back in
const MEMBER_EXCLUDE = {
    exclude: ['sysDetails']
};

// The response of §3.7, and there is no reduced form: the same shape is returned by the row
// operations and by every row of the three listings
const toInvestigationTeamMemberResponse = (member: InvestigationTeamMember) => {
    const plain = member.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;

    const investigation = plain.investigation as Record<string, unknown> | null | undefined;
    if( investigation ) delete investigation.sysDetails;

    return plain;
}

// The read every operation shares to build its response. The investigation include is mandatory and
// not decorative: with required: true and the isActive filter it is what implements the inherited
// visibility, so a member hanging from a retired investigation simply does not come back
const findInvestigationTeamMemberWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await InvestigationTeamMember.findOne({
        where: includeInactive ? { investigationTeamMemberId: id } : { investigationTeamMemberId: id, isActive: true },
        attributes: MEMBER_EXCLUDE,
        include: [{
            ...INVESTIGATION_INCLUDE,
            required: true,
            where: includeInactive ? {} : { isActive: true }
        }]
    });
}

// The same read as above without narrowing the attributes of the member, which is the precondition
// of buildDifferentialUpdate: an instance read with a narrowed `attributes` reads back undefined
// for the columns it left out, and every comparison against undefined would count as a change. It
// still carries the investigation include, so the inherited visibility is checked in the same query
// the update instance comes from
const findInvestigationTeamMemberRow = async (id: string, includeInactive: boolean = false) => {
    return await InvestigationTeamMember.findOne({
        where: includeInactive ? { investigationTeamMemberId: id } : { investigationTeamMemberId: id, isActive: true },
        include: [{
            ...INVESTIGATION_INCLUDE,
            required: true,
            where: includeInactive ? {} : { isActive: true }
        }]
    });
}

// The investigation must exist and be active: a retired investigation does not take new members.
// The operation code travels in so the AppError keeps it
const assertInvestigationIsValid = async (investigationId: string, op: string, lang: string) => {
    const investigation = await Investigation.findOne({
        where: { investigationId, isActive: true },
        attributes: ['investigationId']
    });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationTeamMember.investigationNotFound', lang),
            404,
            `INVTEAM_${ op }_INVESTIGATION_NOT_FOUND`
        );
    }
}

// The same check as assertInvestigationIsValid, relaxed by canViewInactive: the inherited
// visibility applied to the listings, where the parent is not the target of the write but the gate
// to the collection. A retired investigation answers 404 for USER and ADMIN, and comes back for
// whoever may see inactive rows, today SUPERADMIN.
//
// A retired investigation answers 404 instead of an empty page, because an empty page would say
// "this investigation has no team" to somebody who is simply not allowed to see it
const assertInvestigationIsVisible = async (
    investigationId: string,
    op: string,
    lang: string,
    canViewInactive: boolean = false
) => {
    const investigation = await Investigation.findOne({
        where: canViewInactive ? { investigationId } : { investigationId, isActive: true },
        attributes: ['investigationId']
    });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationTeamMember.investigationNotFound', lang),
            404,
            `INVTEAM_${ op }_INVESTIGATION_NOT_FOUND`
        );
    }
}

// The include shared by the three listings. required: true keeps it an INNER JOIN, and its where
// carries the inherited visibility — the same criterion the parent guard already applied over the
// :id of the route, kept here so a row cannot come back through a join the guard did not cover
const listInclude = (includeInactive: boolean) => [{
    ...INVESTIGATION_INCLUDE,
    required: true,
    where: includeInactive ? {} : { isActive: true }
}];

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all. institutionName goes through here and NOT through toTitleCase, against the general
// rule of the conventions: the institution names of this domain are acronyms — MINSAL, ISP, OPS —
// and title casing them would turn them into Minsal, Isp and Ops, corrupting a value that is
// printed on an official document
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// The name is the one field that does carry title case, and it is normalized before being compared
// anywhere: the duplicate guard reads the normalized value, and so does the diff of 004. Comparing
// the raw one would let 'ana pérez' look like a change over a stored 'Ana Pérez'

// Lowercased on top of the trim. The column is citext, so Postgres already ignores case when
// comparing, but the diff of 004 compares text in the application: without this, 'ANA@X.CL' over a
// stored 'ana@x.cl' would produce a difference that the database itself does not recognize
const normalizeEmail = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
}

// The duplicate guard of 001 and 004, and the first of the repository resting on a free text field:
// there is no UNIQUE in the DDL and no catalog to resolve against, so this is a business rule of the
// service and nothing else. It compares the already normalized fullName against the ACTIVE rows of
// the same investigation — a retired member does not block registering the same person again, which
// is the normal way of undoing a mistaken create without going through 005B.
//
// What it does not cover is declared in §7 of the spec: it is an exact match over normalized text,
// so 'Juan Pérez' and 'Juan Perez' are two different people here. It is not deduplication
const assertFullNameIsAvailable = async (
    investigationId: string,
    fullName: string,
    op: string,
    lang: string,
    excludeId?: string
) => {
    const where: WhereOptions = excludeId
        ? { investigationId, fullName, isActive: true, investigationTeamMemberId: { [Op.ne]: excludeId } }
        : { investigationId, fullName, isActive: true };

    const existing = await InvestigationTeamMember.findOne({
        where,
        attributes: ['investigationTeamMemberId']
    });
    if( existing ) {
        throw new AppError(
            getMessage('investigationTeamMember.alreadyExists', lang, { fullName }),
            409,
            `INVTEAM_${ op }_ALREADY_EXISTS`
        );
    }
}

// Create Investigation Team Member Service
// Code: ESAVI-INVTEAM-001
const createInvestigationTeamMemberService = async (
    data: CreateInvestigationTeamMemberInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    // The four steps of §3.5, in this order: the parent first, because a 404 over the investigation
    // makes every other check meaningless; the normalization second, because the guard has to read
    // the value that is going to be stored and not the one the client typed
    await assertInvestigationIsValid(data.investigationId, '001', lang);

    const fullName = normalizeName(data.fullName);

    await assertFullNameIsAvailable(data.investigationId, fullName, '001', lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-INVTEAM-001',
        detail: 'Investigation team member created by service'
    };

    // sortOrder is deliberately absent from this object AND from CREATE_FIELDS: the trigger assigns
    // COALESCE(MAX("sortOrder"), 0) + 1 over the live rows of the same investigation. A create with
    // only investigationId and fullName is valid and leaves the four optional columns null
    const created = await InvestigationTeamMember.create({
        investigationId: data.investigationId,
        fullName,
        institutionName: normalizeText(data.institutionName),
        email: normalizeEmail(data.email),
        phone: normalizeText(data.phone),
        notes: normalizeText(data.notes),
        isActive: true,
        appDetails: [newEntry]
    }, { fields: CREATE_FIELDS });

    // Re-read so the response carries the resolved investigation, its status and its case, and the
    // sortOrder the trigger assigned, which the create instance does not know
    const member = await findInvestigationTeamMemberWithRelations(created.investigationTeamMemberId, true);
    return member ? toInvestigationTeamMemberResponse(member) : null;
}

// Get Investigation Team Members By Investigation Service
// Code: ESAVI-INVTEAM-002A
// The listing is entered by the foreign key and never by /: the members of an investigation only
// make sense read together and in their order, and a global listing would return a jumble of people
// from different investigations paginated by createdAt, which answers no question of the domain.
//
// Ordered by sortOrder ascending, which is the whole point of the column, and with NO filter by
// query: institutionName, email and free text search are out of the scope of this spec
const getInvestigationTeamMembersByInvestigationService = async (
    investigationId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await assertInvestigationIsVisible(investigationId, '002A', lang, canViewInactive);

    const members = await InvestigationTeamMember.findAndCountAll({
        where: { investigationId, isActive: true },
        attributes: MEMBER_EXCLUDE,
        include: listInclude(canViewInactive),
        order: LIST_ORDER,
        limit,
        offset
    });

    return {
        count: members.count,
        rows: members.rows.map(toInvestigationTeamMemberResponse)
    };
}

// Get All Investigation Team Members By Investigation Service - For Admin
// Code: ESAVI-INVTEAM-002B
// The same listing as 002A without the isActive filter: it is the only door to a member that was
// retired, and therefore the entry point of whoever is going to reactivate or purge it.
// paranoid: false is declarative here — the model is not paranoid, so deletedAt is a plain column
// and no scope would hide the sealed rows — and it is written for the same reason
// entityActivation.service.ts writes it: the intent is to see everything, including what a 005A
// sealed. Those are exactly the rows IX_investigationTeamMember_investigation exists for: the
// partial unique index of esaviapp.sql:1350-1352 leaves them out.
//
// The parent guard still applies: an ADMIN sees inactive members, not the members of an inactive
// investigation
const getAllInvestigationTeamMembersByInvestigationService = async (
    investigationId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await assertInvestigationIsVisible(investigationId, '002B', lang, canViewInactive);

    const members = await InvestigationTeamMember.findAndCountAll({
        where: { investigationId },
        attributes: MEMBER_EXCLUDE,
        include: listInclude(canViewInactive),
        order: LIST_ORDER,
        paranoid: false,
        limit,
        offset
    });

    return {
        count: members.count,
        rows: members.rows.map(toInvestigationTeamMemberResponse)
    };
}

// Get Investigation Team Member By ID Service
// Code: ESAVI-INVTEAM-003
// The :id is the investigationTeamMemberId, and this is where the entity parts company with F29 and
// F30: there the primary key was the investigationId, so 003 was already the access by
// investigation. Here that access is 002A, and this operation reads one person.
//
// Two conditions are relaxed by the same flag, and both live inside the shared read: the isActive of
// the row itself and the isActive of its investigation. A member retired by a 005A and a member
// whose investigation was retired answer the same 404 to a USER, and both come back for whoever may
// see inactive rows
const getInvestigationTeamMemberByIdService = async (
    id: string,
    lang: string,
    includeInactive: boolean = false
) => {
    const member = await findInvestigationTeamMemberWithRelations(id, includeInactive);
    if( !member ) {
        throw new AppError(
            getMessage('investigationTeamMember.notFound', lang),
            404,
            'INVTEAM_003_NOT_FOUND'
        );
    }

    return toInvestigationTeamMemberResponse(member);
}

// Get Investigation Team Members By Case Service
// Code: ESAVI-INVTEAM-006
// The real query of the domain: the client holds the caseId, not the investigationId. It crosses
// the one to one hop up to the investigation, from which N members hang, and returns { count, rows }
// like the two listings — unlike F29 and F30, where the whole chain was one to one and the 006
// answered with a single record.
//
// The two 404 are deliberately distinct, and the difference matters to the client: it needs to know
// which link of the chain broke — whether the case is not there, or whether it has no visible
// investigation. Those are two different actions on the user's side, and one generic message would
// make them indistinguishable.
//
// Only the active members come back, with the same criterion as 002A: whoever needs the retired
// ones enters through 002B, which is the admin door
const getInvestigationTeamMembersByCaseIdService = async (
    caseId: string,
    lang: string,
    includeInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const esaviCase = await EsaviCase.findOne({
        where: { caseId, isActive: true },
        attributes: ['caseId']
    });
    if( !esaviCase ) {
        throw new AppError(
            getMessage('investigationTeamMember.caseNotFound', lang),
            404,
            'INVTEAM_006_CASE_NOT_FOUND'
        );
    }

    const where = includeInactive ? { caseId } : { caseId, isActive: true };
    const investigation = await Investigation.findOne({ where, attributes: ['investigationId'] });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationTeamMember.investigationNotFound', lang),
            404,
            'INVTEAM_006_INVESTIGATION_NOT_FOUND'
        );
    }

    // An investigation with no team answers 200 with an empty page and never 404: the chain is
    // whole, there is simply nobody recorded yet
    const members = await InvestigationTeamMember.findAndCountAll({
        where: { investigationId: investigation.investigationId, isActive: true },
        attributes: MEMBER_EXCLUDE,
        include: listInclude(includeInactive),
        order: LIST_ORDER,
        limit,
        offset
    });

    return {
        count: members.count,
        rows: members.rows.map(toInvestigationTeamMemberResponse)
    };
}

// Update Investigation Team Member Service
// Code: ESAVI-INVTEAM-004
// investigationId and sortOrder are ignored whether or not they arrive in the body, and neither
// returns 400. The first because a member does not move between investigations — that would take a
// person to another patient's file — and the second because the order is governed by the database.
// Ignoring in silence is what keeps working the PUT that resends the response of its own GET, the
// normal use of a form
const updateInvestigationTeamMemberService = async (
    id: string,
    data: Partial<CreateInvestigationTeamMemberInput>,
    authUser: AuthUser | undefined,
    lang: string,
    canViewInactive: boolean = false
) => {
    const member = await findInvestigationTeamMemberRow(id, canViewInactive);
    if( !member ) {
        throw new AppError(
            getMessage('investigationTeamMember.notFound', lang),
            404,
            'INVTEAM_004_NOT_FOUND'
        );
    }

    // The name is normalized once and used twice: by the duplicate guard and by the diff. The guard
    // runs only when fullName travels — with no new name there is nothing to check — and it runs
    // BEFORE the diff and independently of it: renaming a row to a name another ACTIVE member of the
    // same investigation already holds is a 409 even if nothing else in the body changes
    const fullName = data.fullName !== undefined ? normalizeName(data.fullName) : undefined;
    if( fullName !== undefined ) {
        await assertFullNameIsAvailable(member.investigationId, fullName, '004', lang, id);
    }

    // Differential update — SPEC F12: only what really changed reaches the UPDATE. Resending whole
    // the record just read with a GET is the normal use of a form, and writing it back would fill
    // appDetails with entries that record no change and hide the real ones among them.
    // The row is read whole, with no narrowed attributes: that is the precondition of
    // buildDifferentialUpdate
    const stored = member.get({ plain: true }) as Record<string, unknown>;

    // The five data fields, all compared against undefined and NEVER by truthiness: an
    // `if( data.x )` would make it impossible to erase a stored value with an explicit null.
    // Every one of them enters ALREADY NORMALIZED, which is what keeps a client resending
    // 'ana pérez' over a stored 'Ana Pérez' — or 'ANA@X.CL' over 'ana@x.cl' — from counting as a
    // change. investigationId, sortOrder, investigationTeamMemberId and isActive are not here:
    // the first two are immutable, the third is the primary key and the last is governed by 005A
    // and 005B
    const candidates: Record<string, unknown> = {
        // Modifiable but not erasable, and the only field without the `?? null` of the nullable
        // ones: the validator already rejected an explicit null, so what arrives here is a name
        fullName,
        // Without toTitleCase, deliberately: MINSAL must not become Minsal
        institutionName: data.institutionName !== undefined ? normalizeText(data.institutionName) : undefined,
        email: data.email !== undefined ? normalizeEmail(data.email) : undefined,
        phone: data.phone !== undefined ? normalizeText(data.phone) : undefined,
        notes: data.notes !== undefined ? normalizeText(data.notes) : undefined
    };

    const objectToUpdate = buildDifferentialUpdate(stored, candidates);

    // Nothing changed: no UPDATE, no updatedAt and no audit entry. It also spares the row the
    // sysDetails.version bump that TRG_investigationTeamMember_setSysDetails fires on every write
    if( Object.keys(objectToUpdate).length === 0 ) {
        const unchanged = await findInvestigationTeamMemberWithRelations(id, true);
        return unchanged ? toInvestigationTeamMemberResponse(unchanged) : null;
    }

    // Written by hand so the service does not depend on a trigger for a column it owns: the generic
    // loop of esaviapp.sql drops TRG_<table>_setUpdatedAt and never creates it
    objectToUpdate.updatedAt = new Date();

    // The history is extended, never overwritten
    const currentAppDetails = Array.isArray(member.appDetails) ? member.appDetails : [];
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-INVTEAM-004',
        detail: 'Investigation team member updated by service'
    };
    await member.update({
        ...objectToUpdate,
        appDetails: [
            ...currentAppDetails,
            newEntry
        ]
    });

    const updated = await findInvestigationTeamMemberWithRelations(id, true);
    return updated ? toInvestigationTeamMemberResponse(updated) : null;
}

// UQ_investigationTeamMember_parent_sortOrder is a partial unique index over
// (investigationId, sortOrder) WHERE deletedAt IS NULL AND sortOrder IS NOT NULL
// (esaviapp.sql:1350-1352). A 005A seals deletedAt, so the number leaves both the index and the MAX
// the insert trigger computes, and a later create legitimately reuses it. The moment
// setEntityActiveStatusService clears deletedAt, the reactivated row re-enters the index carrying a
// number another live row already holds, and the UPDATE dies with a constraint violation — a 500
// for an operation that should answer 200.
//
// The fix is to move the number before touching deletedAt: while deletedAt is still sealed the row
// is outside the partial index, so this write is free. Inverting the two steps makes the index fail
// inside the helper's own UPDATE — the constraint is not deferrable and there would be no way to
// fix it afterwards.
//
// This is a write with an intention of its own over a field the client neither sent nor can send,
// so it does not go through buildDifferentialUpdate: it does not come from comparing an incoming
// value against the stored one, but from a constraint of the database.
//
// A missing row is left alone: the helper right after raises the 404. An already active row finds
// no collision either — the index guarantees no other live row shares its number — so nothing is
// written and the helper raises its 409 as usual.
//
// This is the sixth copy of this block in the repository, after F16, F21, F22, F24 and F27.
// Extracting it into a common helper is the clearest candidate for a consolidation spec, and it is
// not done here because it would touch five entities already marked Implementado
const reassignSortOrderOnCollision = async (id: string, transaction: Transaction) => {
    const member = await InvestigationTeamMember.findOne({
        where: { investigationTeamMemberId: id },
        paranoid: false,
        transaction
    });
    if( !member || member.deletedAt === null ) {
        return;
    }

    const collision = await InvestigationTeamMember.findOne({
        where: {
            investigationId: member.investigationId,
            sortOrder: member.sortOrder as number,
            deletedAt: null,
            investigationTeamMemberId: { [Op.ne]: id }
        },
        attributes: ['investigationTeamMemberId'],
        paranoid: false,
        transaction
    });
    if( !collision ) {
        return;
    }

    // The same count TRG_investigationTeamMember_setSortOrder does on insert, so the reactivated
    // member reappears at the end of the list
    const highest = await InvestigationTeamMember.max<number, InvestigationTeamMember>('sortOrder', {
        where: { investigationId: member.investigationId, deletedAt: null },
        transaction
    });

    await member.update(
        { sortOrder: ( Number(highest) || 0 ) + 1 },
        { transaction, fields: ['sortOrder'] }
    );
}

// Set Investigation Team Member Activation Service
// Code: ESAVI-INVTEAM-005A / ESAVI-INVTEAM-005B
// One service for the two operations, as the rest of the repository does it. Neither is a
// differential update: they are state writes with an intent of their own, they record a fact even
// though no data column changes, and that is why they go through setEntityActiveStatusService and
// never through buildDifferentialUpdate.
//
// Neither applies the inherited visibility either, and this is the difference with F29 and F30:
// whoever retires or reactivates acts over the state of the row itself, and that state exists
// independently of the parent. Retiring the member of an investigation that was withdrawn works.
//
// The 005A seals deletedAt, which frees the sortOrder from the partial unique index. That is
// correct and deliberate: the gap stays available for the next member.
//
// The 005A is blocked by nothing. investigationTeamMember is a leaf of the graph: nothing hangs
// from a member, so there are no children to query and no state to drag
const setInvestigationTeamMemberActivationService = async (
    id: string,
    authUser: AuthUser | undefined,
    lang: string,
    isActive: boolean = true
) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        // Only on the way back: a 005A is what frees the number, so it never collides.
        // The reactivation revalidates nothing else — not the duplicate fullName, not the state of
        // the investigation. Bringing a row back to life is undoing a deactivation, not rewriting
        // it. The consequence — a 005B can leave two active rows with the same fullName in one
        // investigation — is assumed and declared in §6 of the spec: the alternative leaves an
        // ADMIN with a row that can never come back and nothing to do about it but purge it
        if( isActive ) {
            await reassignSortOrderOnCollision(id, transaction);
        }

        const member = await setEntityActiveStatusService({
            model: InvestigationTeamMember,
            where: { investigationTeamMemberId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('investigationTeamMember.notFound', lang),
            notFoundCode: `INVTEAM_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`investigationTeamMember.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `INVTEAM_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-INVTEAM-${ op }`,
                detail: `Investigation team member ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return member;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// Purging Investigation Team Member Service - For SuperAdmin
// Code: ESAVI-INVTEAM-005C
// investigationTeamMember is outside the preventPhysicalDelete loop of esaviapp.sql:1364-1377, so
// the row can really be destroyed.
//
// purgeEntityService serves as it is, with no modification, and here is the difference with F29 and
// F30: those two tables have no isActive column, so the canonical guard the helper carries inside —
// the row must have been retired with a 005A first, 409 otherwise — was inert over them
// (undefined !== true lets every row through) and both had to reach for assertRowIsSealed. This
// entity has the column, so the guard bites on its own and the helper of rowSeal.helper.ts is
// neither consumed nor needed.
//
// The inherited visibility is not applied either: purging is an operation over the state of the
// row, and a member of a retired investigation is still purgeable.
//
// No appDetails entry: the row is destroyed in the same transaction, which is the absence
// CONVENTIONS.md §6 declares legitimate. The only trace is the warn snapshot the helper writes
const purgeInvestigationTeamMemberService = async (
    id: string,
    authUser: AuthUser | undefined,
    lang: string
) => {
    const transaction = await sequelize.transaction();
    try {
        await purgeEntityService({
            model: InvestigationTeamMember,
            where: { investigationTeamMemberId: id },
            transaction,
            operationCode: 'ESAVI-INVTEAM-005C',
            userId: authUser?.userId || 'undefined',
            notFoundMessage: getMessage('investigationTeamMember.notFound', lang),
            notFoundCode: 'INVTEAM_005C_NOT_FOUND',
            stillActiveMessage: getMessage('investigationTeamMember.alreadyActive', lang, { id }),
            stillActiveCode: 'INVTEAM_005C_STILL_ACTIVE'
        });
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createInvestigationTeamMemberService,
    purgeInvestigationTeamMemberService,
    setInvestigationTeamMemberActivationService,
    updateInvestigationTeamMemberService,
    getInvestigationTeamMembersByCaseIdService,
    getInvestigationTeamMemberByIdService,
    getInvestigationTeamMembersByInvestigationService,
    getAllInvestigationTeamMembersByInvestigationService
};
