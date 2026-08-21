import { CatalogItem, EsaviCase, Investigation, InvestigationAutopsy } from '../models';
import { AppError, getMessage, toTimeString } from '../helpers';
import { AppDetails, AuthUser, CreateInvestigationAutopsyInput } from '../types';

// The investigation travels in every response: it is what governs the visibility of the autopsy,
// and hiding it would leave the client unable to explain why a record it read yesterday now
// answers 404. Its own sysDetails stays out, like the one of the autopsy.
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
const AUTOPSY_EXCLUDE = {
    exclude: ['sysDetails']
};

// The two autopsy flags are returned exactly as stored, null included: they are never normalized
// to false when building the response. A null means the form did not collect the answer, and false
// means the investigator deliberately answered no.
// There is no isActive to return — the table does not have that column. deletedAt is the only
// status mark the row carries, and investigation.isActive is the real source of its visibility.
// The three dates come back as 'YYYY-MM-DD' and deathTime as 'HH:mm:ss', which is what DATEONLY
// and TIME give: the normalized form, never the one the client sent
const toInvestigationAutopsyResponse = (investigationAutopsy: InvestigationAutopsy) => {
    const plain = investigationAutopsy.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;

    const investigation = plain.investigation as Record<string, unknown> | null | undefined;
    if( investigation ) delete investigation.sysDetails;

    return plain;
}

// The read every operation shares to build its response. The investigation include is mandatory
// and not decorative: with required: true and the isActive filter it is what implements the
// inherited visibility, so an autopsy hanging from a retired investigation simply does not come back
const findInvestigationAutopsyWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await InvestigationAutopsy.findOne({
        where: { investigationId: id },
        attributes: AUTOPSY_EXCLUDE,
        include: [{
            ...INVESTIGATION_INCLUDE,
            required: true,
            where: includeInactive ? {} : { isActive: true }
        }]
    });
}

// The investigation must exist and be active: a retired investigation does not take new autopsies.
// The operation code travels in so the AppError keeps it
const assertInvestigationIsValid = async (investigationId: string, op: string, lang: string) => {
    const investigation = await Investigation.findOne({
        where: { investigationId, isActive: true },
        attributes: ['investigationId']
    });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationAutopsy.investigationNotFound', lang),
            404,
            `INVAUT_${ op }_INVESTIGATION_NOT_FOUND`
        );
    }
}

// The one to one is imposed by the primary key itself, which is also the foreign key: there is no
// extra UNIQUE because none is needed. The lookup does not filter by deletedAt on purpose — a
// sealed autopsy still occupies its investigationId, and only ESAVI-INVAUT-005C frees it. The check
// does not rely on the collision either: a 23505 would reach the client as a 500 and its Postgres
// message says nothing useful. The message carries the investigationId because otherwise the
// client sees a 409 about a row it did not name
const assertAutopsyDoesNotExist = async (investigationId: string, op: string, lang: string) => {
    const existing = await InvestigationAutopsy.findByPk(investigationId, { attributes: ['investigationId'] });
    if( existing ) {
        throw new AppError(
            getMessage('investigationAutopsy.alreadyExists', lang, { investigationId }),
            409,
            `INVAUT_${ op }_ALREADY_EXISTS`
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

// The three dates are compared and stored as plain YYYY-MM-DD strings, which is what DATEONLY
// returns and what the comparison rule of buildDifferentialUpdate expects. The slice also absorbs
// the datetime the validator admits through isISO8601, so a body carrying a full timestamp does
// not smuggle a time into a `date` column
const toIsoDay = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    return String(value).slice(0, 10);
}

// Rule 1 — the two flags are mutually exclusive in true, and it is evaluated over the RESULTING
// state, so on update a single flag travelling is enough to trigger it against the stored one.
// An autopsy cannot have been performed and be scheduled at the same time: when it is performed
// the scheduling stops being the state and becomes the past, and the schema has nowhere to keep
// that sequence. Both in false, both null, or one of each are all valid — not having done the
// autopsy and not having planned it is a normal state
const assertFlagsAreExclusive = (
    resultingPerformed: boolean | null,
    resultingScheduled: boolean | null,
    op: string,
    lang: string
) => {
    if( resultingPerformed === true && resultingScheduled === true ) {
        throw new AppError(
            getMessage('investigationAutopsy.autopsyFlagsExclusive', lang),
            400,
            `INVAUT_${ op }_AUTOPSY_FLAGS_EXCLUSIVE`
        );
    }
}

// Rules 2 and 3 in their strict variant, the one 001 uses: each flag governs its own date, and
// with the flag not true its date is forbidden. On create there is no inherited state to clear —
// everything that arrives, arrives in the body — so accepting in silence a date that would never
// be stored would return a 201 that lies about what it saved.
// The comparison is strict against true, so false and null behave alike here: neither of them
// declares the autopsy, whatever the difference between them means elsewhere.
// With the flag true the date is OPTIONAL: marking that the autopsy was performed without knowing
// the exact date yet is a real state, and demanding it would force the client to invent a datum
const assertAutopsyDatesOnCreate = (data: CreateInvestigationAutopsyInput, lang: string) => {
    if( data.isAutopsyPerformed !== true && data.autopsyDate ) {
        throw new AppError(
            getMessage('investigationAutopsy.autopsyDateNotAllowed', lang),
            400,
            'INVAUT_001_AUTOPSY_DATE_NOT_ALLOWED'
        );
    }

    if( data.isAutopsyScheduled !== true && data.scheduledAutopsyDate ) {
        throw new AppError(
            getMessage('investigationAutopsy.scheduledAutopsyDateNotAllowed', lang),
            400,
            'INVAUT_001_SCHEDULED_AUTOPSY_DATE_NOT_ALLOWED'
        );
    }
}

// Rule 4 — the autopsy does not precede the death. The only rule of this entity that crosses two
// data columns, and the only one that can fire with NEITHER date travelling in the body: correcting
// the deathDate alone is enough to leave a stored autopsyDate behind it. Both are compared as
// YYYY-MM-DD strings, without building a Date, for the same reason the validator does.
// scheduledAutopsyDate is deliberately out of this rule: an autopsy scheduled before the outcome
// is a real case, and its temporal restriction is none
const assertAutopsyDateIsNotBeforeDeath = (
    resultingAutopsyDate: string | null,
    resultingDeathDate: string | null,
    op: string,
    lang: string
) => {
    const autopsyDate = toIsoDay(resultingAutopsyDate);
    const deathDate = toIsoDay(resultingDeathDate);

    if( autopsyDate && deathDate && autopsyDate < deathDate ) {
        throw new AppError(
            getMessage('investigationAutopsy.autopsyDateBeforeDeath', lang, { autopsyDate, deathDate }),
            400,
            `INVAUT_${ op }_AUTOPSY_DATE_BEFORE_DEATH`
        );
    }
}

// Create Investigation Autopsy Service
// Code: ESAVI-INVAUT-001
const createInvestigationAutopsyService = async (
    data: CreateInvestigationAutopsyInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    await assertInvestigationIsValid(data.investigationId, '001', lang);
    await assertAutopsyDoesNotExist(data.investigationId, '001', lang);

    // On create the body is the whole resulting state, so the four rules are evaluated over it
    // directly. They run before anything is written and with independence of it
    assertFlagsAreExclusive(data.isAutopsyPerformed ?? null, data.isAutopsyScheduled ?? null, '001', lang);
    assertAutopsyDatesOnCreate(data, lang);
    assertAutopsyDateIsNotBeforeDeath(data.autopsyDate ?? null, data.deathDate, '001', lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-INVAUT-001',
        detail: 'Investigation autopsy created by service'
    };

    // isDeath is written as true and not taken from the body beyond the validator that already
    // demanded it: the row only exists over a death. The two tri-state flags keep their null —
    // what does not arrive is stored null and never false. deathTime is normalized to HH:mm:ss so
    // that a client resending '14:30' over the stored value produces no difference in the diff.
    // There is no empty create here, and that is the difference with F13, F14 and F29: the minimum
    // is { investigationId, isDeath: true, deathDate } and the seven remaining columns come back
    // null. deletedAt is born null and there is no isActive to set: the investigation had to be
    // active to get here, so an autopsy cannot be created already dragged
    await InvestigationAutopsy.create({
        investigationId: data.investigationId,
        isDeath: true,
        deathDate: toIsoDay(data.deathDate),
        deathTime: data.deathTime ? toTimeString(data.deathTime) : null,
        isAutopsyPerformed: data.isAutopsyPerformed ?? null,
        isAutopsyScheduled: data.isAutopsyScheduled ?? null,
        autopsyDate: toIsoDay(data.autopsyDate),
        scheduledAutopsyDate: toIsoDay(data.scheduledAutopsyDate),
        autopsyComments: normalizeText(data.autopsyComments),
        notes: normalizeText(data.notes),
        appDetails: [newEntry]
    });

    // Re-read so the response carries the resolved investigation, its status and its case, not
    // just the raw identifier
    const created = await findInvestigationAutopsyWithRelations(data.investigationId, true);
    return created ? toInvestigationAutopsyResponse(created) : null;
}

export {
    createInvestigationAutopsyService
};
