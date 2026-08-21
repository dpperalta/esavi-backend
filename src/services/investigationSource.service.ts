import { WhereOptions } from 'sequelize';
import { CatalogItem, EsaviCase, Investigation, InvestigationSource } from '../models';
import { AppError, buildDifferentialUpdate, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateInvestigationSourceInput, InvestigationSourceListFilters } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The investigation travels in every response: it is what governs the visibility of the source,
// and hiding it would leave the client unable to explain why a record it read yesterday now
// answers 404. Its own sysDetails stays out, like the one of the source.
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

// sysDetails is trigger metadata and never leaves the service. investigationId does travel: here
// it is the primary key of the row, and also the identifier of its investigation
const SOURCE_EXCLUDE = {
    exclude: ['sysDetails']
};

// The eight tri-state fields are returned exactly as stored, null included: they are never
// normalized to false when building the response. A null means the form did not collect the
// answer, and false means the investigator deliberately answered no.
// There is no isActive to return — the table does not have that column. deletedAt is the only
// status mark the row carries, and investigation.isActive is the real source of its visibility
const toInvestigationSourceResponse = (investigationSource: InvestigationSource) => {
    const plain = investigationSource.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;

    const investigation = plain.investigation as Record<string, unknown> | null | undefined;
    if( investigation ) delete investigation.sysDetails;

    return plain;
}

// The read every operation shares to build its response. The investigation include is mandatory
// and not decorative: with required: true and the isActive filter it is what implements the
// inherited visibility, so a source hanging from a retired investigation simply does not come back
const findInvestigationSourceWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await InvestigationSource.findOne({
        where: { investigationId: id },
        attributes: SOURCE_EXCLUDE,
        include: [{
            ...INVESTIGATION_INCLUDE,
            required: true,
            where: includeInactive ? {} : { isActive: true }
        }]
    });
}

// The same read as above without narrowing the attributes of the source, which is the precondition
// of buildDifferentialUpdate: an instance read with a narrowed `attributes` reads back undefined
// for the columns it left out, and every comparison against undefined would count as a change. It
// still carries the investigation include, so the inherited visibility is checked in the same
// query the update instance comes from
const findInvestigationSourceRow = async (id: string, includeInactive: boolean = false) => {
    return await InvestigationSource.findOne({
        where: { investigationId: id },
        include: [{
            ...INVESTIGATION_INCLUDE,
            required: true,
            where: includeInactive ? {} : { isActive: true }
        }]
    });
}

// The investigation must exist and be active: a retired investigation does not take new sources.
// The operation code travels in so the AppError keeps it
const assertInvestigationIsValid = async (investigationId: string, op: string, lang: string) => {
    const investigation = await Investigation.findOne({
        where: { investigationId, isActive: true },
        attributes: ['investigationId']
    });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationSource.investigationNotFound', lang),
            404,
            `INVSRC_${ op }_INVESTIGATION_NOT_FOUND`
        );
    }
}

// The one to one is imposed by the primary key itself, which is also the foreign key: there is no
// extra UNIQUE because none is needed. The lookup does not filter by deletedAt on purpose — a
// sealed source still occupies its investigationId, and only ESAVI-INVSRC-005C frees it. The check
// does not rely on the collision either: a 23505 would reach the client as a 500 and its Postgres
// message says nothing useful. The message carries the investigationId because otherwise the
// client sees a 409 about a row it did not name
const assertSourceDoesNotExist = async (investigationId: string, op: string, lang: string) => {
    const existing = await InvestigationSource.findByPk(investigationId, { attributes: ['investigationId'] });
    if( existing ) {
        throw new AppError(
            getMessage('investigationSource.alreadyExists', lang, { investigationId }),
            409,
            `INVSRC_${ op }_ALREADY_EXISTS`
        );
    }
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is
// no text at all. There is neither `code` nor `name` here, so neither toConstantCase nor
// toTitleCase apply
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// The other source rule in its strict variant, the one 001 uses. It lives here and not in the
// validator because on update it is evaluated over the resulting state — what is stored merged
// with what arrives — and the validator only sees the body. It still answers 400: the problem is
// the combination of fields in the body, which is malformed input however it is checked.
// On create there is no stored state, so the resulting other is whatever the body brings.
// Sending a description when the answer is not true is rejected instead of ignored: accepting in
// silence a description that would never be stored would return a 201 that lies about what it
// saved. The comparison is strict against true, so false and null behave alike here — neither of
// them declares another source, whatever the difference between them means elsewhere
const assertOtherRuleOnCreate = (
    other: boolean | null | undefined,
    otherDescription: string | null | undefined,
    lang: string
) => {
    const description = normalizeText(otherDescription);

    if( other === true ) {
        if( !description ) {
            throw new AppError(
                getMessage('investigationSource.otherDescriptionRequired', lang),
                400,
                'INVSRC_001_OTHER_DESCRIPTION_REQUIRED'
            );
        }
        return;
    }

    if( description ) {
        throw new AppError(
            getMessage('investigationSource.otherDescriptionNotAllowed', lang),
            400,
            'INVSRC_001_OTHER_DESCRIPTION_NOT_ALLOWED'
        );
    }
}

// The other source rule in its update variant, evaluated over the RESULTING state and not over the
// body: a PUT that only switches `other` on over a row that already carries a description is
// coherent, and rejecting it would force the client to resend a value that is not changing —
// exactly what the differential update exists to avoid.
//
// The asymmetry with the create is declared and is not an inconsistency: they are two different
// situations. When the source is switched off, the 004 resolves an orphan it did not create — the
// description was stored by an earlier request — so it clears it without asking. The 001 has no
// orphan to resolve, which is why it stays strict.
//
// What is NOT silenced is a body that switches the source off and describes it at the same time:
// that contradicts itself, and swallowing it would lose the text without a word while the client
// believes it was saved. Sending it as null or as an empty string is not an error — that is the
// same destination the forcing reaches on its own
const assertOtherRuleOnUpdate = (
    resultingOther: boolean | null,
    resultingDescription: string | null,
    descriptionTravels: boolean,
    bodyDescription: string | null | undefined,
    lang: string
) => {
    if( resultingOther === true ) {
        if( !resultingDescription ) {
            throw new AppError(
                getMessage('investigationSource.otherDescriptionRequired', lang),
                400,
                'INVSRC_004_OTHER_DESCRIPTION_REQUIRED'
            );
        }
        return;
    }

    // Only when it travels WITH content. An absent description is forced to null further down
    // without error, and a null or blank one is already heading there
    if( descriptionTravels && normalizeText(bodyDescription) ) {
        throw new AppError(
            getMessage('investigationSource.otherDescriptionNotAllowed', lang),
            400,
            'INVSRC_004_OTHER_DESCRIPTION_NOT_ALLOWED'
        );
    }
}

// Create Investigation Source Service
// Code: ESAVI-INVSRC-001
const createInvestigationSourceService = async (
    data: CreateInvestigationSourceInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    await assertInvestigationIsValid(data.investigationId, '001', lang);
    await assertSourceDoesNotExist(data.investigationId, '001', lang);

    // On create the body is the whole resulting state, so the rule is evaluated over it directly
    assertOtherRuleOnCreate(data.other, data.otherDescription, lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-INVSRC-001',
        detail: 'Investigation source created by service'
    };

    // The eight tri-state fields keep their null: what does not arrive is stored null and never
    // false. A create with the ten data columns empty is valid — it is the normal way of opening
    // the row and completing it with the PUT. deletedAt is born null and there is no isActive to
    // set: the investigation had to be active to get here, so a source cannot be created already
    // dragged
    await InvestigationSource.create({
        investigationId: data.investigationId,
        history: data.history ?? null,
        interviewVaccinatedPerson: data.interviewVaccinatedPerson ?? null,
        interviewHealthWorker: data.interviewHealthWorker ?? null,
        vaccinationRecord: data.vaccinationRecord ?? null,
        autopsyRecord: data.autopsyRecord ?? null,
        verbalAutopsyRecord: data.verbalAutopsyRecord ?? null,
        investigationReport: data.investigationReport ?? null,
        other: data.other ?? null,
        otherDescription: normalizeText(data.otherDescription),
        notes: normalizeText(data.notes),
        appDetails: [newEntry]
    });

    // Re-read so the response carries the resolved investigation, its status and its case, not
    // just the raw identifier
    const created = await findInvestigationSourceWithRelations(data.investigationId, true);
    return created ? toInvestigationSourceResponse(created) : null;
}

// The order of the two listings. createdAt is the only chronological column every row carries, and
// it never moves after the insert — unlike updatedAt, which would shuffle the list on every save
const LIST_ORDER: [string, string][] = [['createdAt', 'DESC']];

// Only the filter that lands on the source itself. caseId does not belong here: it is a column of
// the investigation, so it travels in the where of the include instead — the same include that
// already implements the inherited visibility, so filtering by case costs no extra join
const buildListWhere = (filters: InvestigationSourceListFilters): WhereOptions => {
    const where: Record<string, unknown> = {};
    if( filters.investigationId ) where.investigationId = filters.investigationId;
    return where as WhereOptions;
}

// The where of the investigation include, which carries two things at once: the visibility — the
// isActive that separates 002A from 002B — and the caseId filter when it arrives. Both conditions
// live in the same object, so they accumulate with AND
const buildInvestigationWhere = (filters: InvestigationSourceListFilters, includeInactive: boolean): WhereOptions => {
    const where: Record<string, unknown> = {};
    if( !includeInactive ) where.isActive = true;
    if( filters.caseId ) where.caseId = filters.caseId;
    return where as WhereOptions;
}

// The include shared by the two listings. required: true keeps it an INNER JOIN, which is what
// makes the filters above bite and what keeps a source hanging from a retired investigation out
// of 002A
const listInclude = (filters: InvestigationSourceListFilters, includeInactive: boolean) => [{
    ...INVESTIGATION_INCLUDE,
    required: true,
    where: buildInvestigationWhere(filters, includeInactive)
}];

// Get Active Investigation Sources Service
// Code: ESAVI-INVSRC-002A
// The dual listing this entity does have, unlike its two elder sisters. F13 and F14 argued that
// without isActive there are no two variants returning different rows; that is wrong here — the
// visibility is not a column of its own, it is inherited from investigation.isActive. Without a
// 002B an ADMIN would have no way of seeing the source of a retired investigation
const getInvestigationSourcesService = async (
    filters: InvestigationSourceListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await InvestigationSource.findAndCountAll({
        where: buildListWhere(filters),
        attributes: SOURCE_EXCLUDE,
        include: listInclude(filters, false),
        order: LIST_ORDER,
        limit,
        offset
    });
    // The rows carry the same full shape as the 003: there is no reduced shape. The entity has ten
    // data columns and eight of them are the answer itself, so trimming them would leave a listing
    // with no content
    return { count, rows: rows.map(toInvestigationSourceResponse) };
}

// Get All Investigation Sources Service - For Admin
// Code: ESAVI-INVSRC-002B
const getAllInvestigationSourcesService = async (
    filters: InvestigationSourceListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await InvestigationSource.findAndCountAll({
        where: buildListWhere(filters),
        attributes: SOURCE_EXCLUDE,
        include: listInclude(filters, true),
        order: LIST_ORDER,
        limit,
        offset
    });
    return { count, rows: rows.map(toInvestigationSourceResponse) };
}

// Get Investigation Source By ID Service
// Code: ESAVI-INVSRC-003
// The :id is the investigationId: this entity has no identifier of its own, so this is already
// the access by investigation and no separate operation is needed for it.
// Two filters, and the second one is the inherited visibility: the row must exist, and its
// investigation must be active unless canViewInactive says otherwise — today SUPERADMIN. Both
// failures answer the same 404 without distinguishing, because telling them apart would confirm to
// a USER that a source exists under an investigation it is not allowed to see.
// The own deletedAt filters nothing: a dragged row is still readable by whoever can see its
// investigation, which is what makes it possible to consult it before purging it
const getInvestigationSourceByIdService = async (id: string, lang: string, includeInactive: boolean = false) => {
    const investigationSource = await findInvestigationSourceWithRelations(id, includeInactive);
    if( !investigationSource ) {
        throw new AppError(getMessage('investigationSource.notFound', lang), 404, 'INVSRC_003_NOT_FOUND');
    }
    return toInvestigationSourceResponse(investigationSource);
}

// Get Investigation Source By Case ID Service
// Code: ESAVI-INVSRC-006
// The real query of the domain: the client holds the caseId, not the investigationId. It returns
// the record itself and not { count, rows } — the chain case -> investigation -> source is one to
// one on both hops, and wrapping a single record in a collection would force unwrapping a
// one-element array on every screen.
// The three 404 are deliberately distinct, and the asymmetry with 003 is intentional: there the
// client already holds the primary key of the source, here it enters through a caseId and needs to
// know which link of the chain broke — whether the case is not there, whether it has no visible
// investigation, or whether the investigation has no sources recorded yet. Those are three
// different actions on the user's side, and one generic message would make them indistinguishable
const getInvestigationSourceByCaseIdService = async (caseId: string, lang: string, includeInactive: boolean = false) => {
    const esaviCase = await EsaviCase.findOne({
        where: { caseId, isActive: true },
        attributes: ['caseId']
    });
    if( !esaviCase ) {
        throw new AppError(getMessage('investigationSource.caseNotFound', lang), 404, 'INVSRC_006_CASE_NOT_FOUND');
    }

    const where = includeInactive ? { caseId } : { caseId, isActive: true };
    const investigation = await Investigation.findOne({ where, attributes: ['investigationId'] });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationSource.investigationNotFound', lang),
            404,
            'INVSRC_006_INVESTIGATION_NOT_FOUND'
        );
    }

    const investigationSource = await findInvestigationSourceWithRelations(investigation.investigationId, includeInactive);
    if( !investigationSource ) {
        throw new AppError(getMessage('investigationSource.notFound', lang), 404, 'INVSRC_006_NOT_FOUND');
    }
    return toInvestigationSourceResponse(investigationSource);
}

// Update Investigation Source Service
// Code: ESAVI-INVSRC-004
// The main operation of the entity: the ten data columns are nullable and the row is opened empty,
// so this is where the form is actually filled in. investigationId is ignored whether or not it
// arrives in the body. It is the primary key of the row and the foreign key to its investigation at
// the same time: a source is the record of how *that* investigation was carried out, and moving it
// would take the provenance of the information to another patient's file
const updateInvestigationSourceService = async (
    id: string,
    data: Partial<CreateInvestigationSourceInput>,
    authUser: AuthUser | undefined,
    lang: string,
    canViewInactive: boolean = false
) => {
    const investigationSource = await findInvestigationSourceRow(id, canViewInactive);
    if( !investigationSource ) {
        throw new AppError(getMessage('investigationSource.notFound', lang), 404, 'INVSRC_004_NOT_FOUND');
    }

    // Differential update — SPEC F12: only what really changed reaches the UPDATE. Resending whole
    // the record just read with a GET is the normal use of a form, and writing it back would fill
    // appDetails with entries that record no change and hide the real ones among them.
    // The ten fields are compared against undefined and NEVER by truthiness, and in this entity
    // that rule matters more than anywhere else in the repository: eight of the ten columns are
    // booleans, and an `if( data.x )` would make it impossible to store a false — which is exactly
    // the answer "this source was not used", half the domain of the entity
    const stored = investigationSource.get({ plain: true }) as Record<string, unknown>;

    // The resulting state of `other` governs the coherence rule and is computed before anything
    // else. The check runs BEFORE the diff and independently of it
    const resultingOther = data.other !== undefined
        ? ( data.other ?? null )
        : ( ( stored.other as boolean | null ) ?? null );

    const descriptionTravels = data.otherDescription !== undefined;
    const resultingDescription = descriptionTravels
        ? normalizeText(data.otherDescription)
        : ( ( stored.otherDescription as string | null ) ?? null );

    assertOtherRuleOnUpdate(resultingOther, resultingDescription, descriptionTravels, data.otherDescription, lang);

    const candidates: Record<string, unknown> = {
        // The eight sources, tri-state: false is a value and not an absence, and null is what lets
        // the client erase an answer already given instead of only changing it
        history: data.history !== undefined ? ( data.history ?? null ) : undefined,
        interviewVaccinatedPerson: data.interviewVaccinatedPerson !== undefined
            ? ( data.interviewVaccinatedPerson ?? null ) : undefined,
        interviewHealthWorker: data.interviewHealthWorker !== undefined
            ? ( data.interviewHealthWorker ?? null ) : undefined,
        vaccinationRecord: data.vaccinationRecord !== undefined
            ? ( data.vaccinationRecord ?? null ) : undefined,
        autopsyRecord: data.autopsyRecord !== undefined ? ( data.autopsyRecord ?? null ) : undefined,
        verbalAutopsyRecord: data.verbalAutopsyRecord !== undefined
            ? ( data.verbalAutopsyRecord ?? null ) : undefined,
        investigationReport: data.investigationReport !== undefined
            ? ( data.investigationReport ?? null ) : undefined,
        other: data.other !== undefined ? ( data.other ?? null ) : undefined,
        // Conditional derivative, not a cleanup afterwards: when the resulting source is not true
        // the null enters candidates ALWAYS, with no presence check, and it is
        // buildDifferentialUpdate who decides whether it differs. A second UPDATE after the diff
        // would write even when nothing changed, and switching off a source that was already off
        // must not grow appDetails
        otherDescription: resultingOther === true
            ? ( descriptionTravels ? normalizeText(data.otherDescription) : undefined )
            : null,
        // Normalized before comparing, or a body differing only in surrounding blanks would count
        // as a change
        notes: data.notes !== undefined ? normalizeText(data.notes) : undefined
    };

    const objectToUpdate = buildDifferentialUpdate(stored, candidates);

    // Nothing changed: no UPDATE, no updatedAt and no audit entry. It also spares the row the
    // sysDetails.version bump that TRG_investigationSource_setSysDetails fires on every write
    if( Object.keys(objectToUpdate).length === 0 ) {
        const unchanged = await findInvestigationSourceWithRelations(id, true);
        return unchanged ? toInvestigationSourceResponse(unchanged) : null;
    }

    // Written by hand so the service does not depend on a trigger for a column it owns: the
    // generic loop of esaviapp.sql drops TRG_<table>_setUpdatedAt and never creates it
    objectToUpdate.updatedAt = new Date();

    // The history is extended, never overwritten
    const currentAppDetails = Array.isArray(investigationSource.appDetails) ? investigationSource.appDetails : [];
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-INVSRC-004',
        detail: 'Investigation source updated by service'
    };
    await investigationSource.update({
        ...objectToUpdate,
        appDetails: [
            ...currentAppDetails,
            newEntry
        ]
    });

    const updated = await findInvestigationSourceWithRelations(id, true);
    return updated ? toInvestigationSourceResponse(updated) : null;
}

export {
    createInvestigationSourceService,
    getInvestigationSourcesService,
    getAllInvestigationSourcesService,
    getInvestigationSourceByIdService,
    getInvestigationSourceByCaseIdService,
    updateInvestigationSourceService
};
