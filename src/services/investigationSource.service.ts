import { CatalogItem, EsaviCase, Investigation, InvestigationSource } from '../models';
import { AppError, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateInvestigationSourceInput } from '../types';

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

export {
    createInvestigationSourceService
};
