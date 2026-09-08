import { InferAttributes, Op, Transaction } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, CatalogType, DiagnosticTerm, Investigation, InvestigationDiagnostic } from '../models';
import { AppError, getMessage, toConstantCase } from '../helpers';
import { resolveDiagnosticTermService } from './common/diagnosticTermResolution.service';
import { AppDetails, AuthUser, CreateInvestigationDiagnosticInput } from '../types';
import { TermSource } from '../constants/enums.constants';
import { DIAGNOSTIC_TYPE_CATALOG_CODE } from '../constants/investigation.constants';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The source that admits implicit creation, and the only one the resolver of F15 ever writes: a
// client cannot coin a MedDRA or WHODrug term by typing one into a form
const LOCAL_SOURCE: TermSource = 'LOCAL';

// The columns the INSERT of ESAVI-INVDIAG-001 writes, listed one by one so sortOrder stays out of
// it. Omitting the value is not enough: the column is allowNull: false and Sequelize runs its own
// notNull validation over every attribute of the create before reaching Postgres, so an unlisted
// sortOrder would be rejected in the application and TRG_investigationDiagnostic_setSortOrder would
// never get to assign it. Passing the field list is what makes the column absent from the
// statement. diagnosticId is out for the same reason it is out of the body: gen_random_uuid()
// writes it
const CREATE_FIELDS: (keyof InferAttributes<InvestigationDiagnostic>)[] = [
    'investigationId',
    'diagnosticTermId',
    'diagnosticRaw',
    'diagnosticDate',
    'diagnosticTypeItemId',
    'notes',
    'isActive',
    'appDetails'
];

// The columns every response carries, listed one by one instead of dropped afterwards. sysDetails
// is trigger bookkeeping and never leaves the service, and an explicit list is what keeps it out
// without having to mention it
const RESPONSE_ATTRIBUTES: (keyof InferAttributes<InvestigationDiagnostic>)[] = [
    'diagnosticId',
    'investigationId',
    'diagnosticTermId',
    'diagnosticRaw',
    'diagnosticDate',
    'diagnosticTypeItemId',
    'sortOrder',
    'notes',
    'isActive',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'appDetails'
];

// The parent, read on every operation to implement the inherited visibility. A single hop, unlike
// the two of investigationPregnancyCondition: investigation carries its own isActive, so the state
// is read in one go and there is no chain to walk with paranoid: false.
//
// The investigation never reaches the response: whoever needs it enters through ESAVI-INVESTGN-003
const INVESTIGATION_INCLUDE = {
    model: Investigation,
    as: 'investigation',
    attributes: ['investigationId', 'isActive']
};

// The resolved master term, with six fields. The jsonb column of the master stays out: it carries
// the internal markers of the implicit resolution — autoCreated, reviewStatus — which are
// governance of the catalog and not data of the investigation. It is the decision of F16, F27, F33
// and F57, literal.
//
// The include does not filter by isActive, deliberately: a term retired after the record was
// written still says what the diagnosis was coded as
const DIAGNOSTIC_TERM_INCLUDE = {
    model: DiagnosticTerm,
    as: 'diagnosticTerm',
    attributes: ['diagnosticTermId', 'source', 'code', 'name', 'termGroup', 'isActive']
};

// The diagnosticType item, with four fields and neither sortOrder nor isActive of the catalog: the
// order of the catalog is the business of whoever paints the dropdown, and ESAVI-CATITEM-002A is
// where that is asked for. It does not filter by isActive either, so a type deactivated after the
// fact still comes back and the client sees the real state
const DIAGNOSTIC_TYPE_INCLUDE = {
    model: CatalogItem,
    as: 'diagnosticType',
    attributes: ['catalogItemId', 'code', 'name', 'value']
};

// The parent is dropped here after having done its job in the query, and the two catalog reads come
// back as an explicit null when the diagnosis was recorded without a code or without a type, so a
// client does not have to tell "empty" from "absent".
//
// The name the client displays is diagnosticRaw ?? diagnosticTerm.name. There is no third field
// resolving it, and that is the simplification the DDL imposes: when diagnosticRaw is null the
// investigator wrote exactly what the master says
const toInvestigationDiagnosticResponse = (diagnostic: InvestigationDiagnostic) => {
    const plain = diagnostic.toJSON() as Record<string, unknown>;
    delete plain.investigation;

    plain.diagnosticTerm = plain.diagnosticTerm ?? null;
    plain.diagnosticType = plain.diagnosticType ?? null;

    return plain;
}

// The investigation must exist and be active: a retired investigation takes no new diagnoses.
// statusItemId is deliberately not checked — a final diagnosis is recorded the same way over an
// investigation in progress as over a closed one, and over a recovered patient as over a deceased
// one.
//
// investigationClinicalEvaluation is not checked either, neither its existence nor its state. That
// is the decision of §1.C: a final diagnosis can arrive by laboratory report, by hospital discharge
// summary or by autopsy, without the clinical evaluation ever having been run.
//
// The two reasons — it does not exist, it is inactive — share code and message: telling them apart
// is of no use to the investigator, and distinguishing them would confirm to a USER that an
// investigation exists which it is not allowed to see
const findValidInvestigation = async (investigationId: string, op: string, lang: string) => {
    const investigation = await Investigation.findOne({
        where: { investigationId, isActive: true },
        attributes: ['investigationId', 'isActive']
    });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationDiagnostic.investigationNotFound', lang),
            404,
            `INVDIAG_${ op }_INVESTIGATION_NOT_FOUND`
        );
    }
    return investigation;
}

// The same check as findValidInvestigation, relaxed by canViewInactive: the inherited visibility
// applied to the listings, where the parent is not the target of the write but the gate to the
// collection. A retired investigation answers 404 for USER and ADMIN, and comes back for whoever may
// see inactive rows, today SUPERADMIN.
//
// Only the state is relaxed. Existence is relaxed for nobody: an investigation that does not exist
// has no diagnoses to list under any role, and answering an empty page would be a different lie.
//
// A retired investigation answers 404 instead of an empty page, because an empty page would say
// "this investigation has no diagnoses" to somebody who is simply not allowed to see them
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
            getMessage('investigationDiagnostic.investigationNotFound', lang),
            404,
            `INVDIAG_${ op }_INVESTIGATION_NOT_FOUND`
        );
    }
}

// The guard of the diagnosticTypeItemId of 001 and 004, with the three usual conditions: the item
// exists, it is active, and its catalogType is diagnosticType. Any of the three failing answers the
// same 400 — telling them apart would only help somebody probing the catalog.
//
// The catalog code is read from src/constants/investigation.constants.ts and never written as a
// literal here. It is the rule the acceptance criteria of F28 verify by grep, and it only works if
// there is a single place to look.
//
// It only runs when the value has a value. An explicit null does not go through the guard: it is a
// legitimate erasure, and the 004 treats it as a change of value. And there is no default: unlike
// investigation.statusItemId, an absent type is stored as null, because "presumptive" and "not
// stated" are not the same thing
const assertValidDiagnosticType = async (
    diagnosticTypeItemId: string | null | undefined,
    op: string,
    lang: string,
    transaction?: Transaction
) => {
    if( !diagnosticTypeItemId ) return;

    const item = await CatalogItem.findOne({
        where: { catalogItemId: diagnosticTypeItemId, isActive: true },
        attributes: ['catalogItemId'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: DIAGNOSTIC_TYPE_CATALOG_CODE },
            attributes: []
        }],
        transaction
    });
    if( !item ) {
        throw new AppError(
            getMessage('investigationDiagnostic.invalidDiagnosticType', lang),
            400,
            `INVDIAG_${ op }_INVALID_DIAGNOSTIC_TYPE`
        );
    }
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all. Neither goes through toTitleCase or toConstantCase: diagnosticName and notes are the
// copy of what the investigator wrote and their only value is reproducing it. The one value that
// does get constant cased is the code, and only inside the resolution — where it is the key of the
// master lookup and never a column of this table.
//
// This is the tenth copy of this helper in the repository. Extracting it is overdue since F24 §7 and
// has its own spec pending, because doing it here would drag nine foreign services into a CRUD
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// What the resolution against the clinical master leaves behind: two derived values and not three.
// This table has a single text column, so there is nowhere to denormalize the canonical name or the
// code — both are read from diagnosticTerm through the include, and that is the simplification the
// DDL imposes
interface ResolvedDiagnosticTerm {
    diagnosticTermId: string | null;
    diagnosticRaw: string | null;
}

// The resolution of ESAVI-INVDIAG-001 and 004, in three branches.
//
// Without a code there is no term: the name is the free text of the investigator and there is
// nothing to diverge from, so diagnosticRaw keeps it as it is. With a code and LOCAL — or no source
// at all — the resolver of F15 answers, creating the term when it does not exist yet, which is the
// whole point of the implicit resolution. With a code and an external source the pair (source, code)
// is looked up and nothing is ever created: a client cannot coin a MedDRA term by writing one in a
// form.
//
// The external lookup does not filter by isActive, for the same reason
// diagnosticTermResolution.service.ts:37-38 does not: a retired term is still referenceable, and
// resolving away from it would silently undo an administrator's decision.
//
// Whatever the branch, the master rules over the name and the divergence is preserved: diagnosticRaw
// holds what the investigator wrote and only when it differs from what the catalog says. When it
// comes back null the investigator wrote exactly the name of the master
const resolveDiagnosticTerm = async (
    diagnosticCode: string | null | undefined,
    diagnosticName: string,
    source: TermSource | null | undefined,
    op: string,
    authUser: AuthUser | undefined,
    lang: string,
    transaction: Transaction
): Promise<ResolvedDiagnosticTerm> => {
    const rawName = diagnosticName.trim();
    const trimmedCode = normalizeText(diagnosticCode);

    if( !trimmedCode ) {
        return { diagnosticTermId: null, diagnosticRaw: rawName };
    }

    // Same normalization as ESAVI-DIAGTERM-001, 006 and 007, or neither branch would find what the
    // catalog saved. It is applied to the code and never to the name: the toConstantCase belongs to
    // the resolver's contract, and the name is the investigator's text
    const code = toConstantCase(trimmedCode);
    let term: DiagnosticTerm | null;

    if( !source || source === LOCAL_SOURCE ) {
        term = await resolveDiagnosticTermService(
            { code, name: rawName, operationCode: `ESAVI-INVDIAG-${ op }` },
            authUser,
            lang,
            transaction
        );
    } else {
        term = await DiagnosticTerm.findOne({
            where: { source, code },
            transaction
        });
        if( !term ) {
            throw new AppError(
                getMessage('investigationDiagnostic.diagnosticTermNotFound', lang, { code, source }),
                404,
                `INVDIAG_${ op }_DIAGTERM_NOT_FOUND`
            );
        }
    }

    return {
        diagnosticTermId: term.diagnosticTermId,
        diagnosticRaw: term.name === rawName ? null : rawName
    };
}

// The duplicate guard of 001 and 004: diagnosticTermId may not repeat among the ACTIVE diagnoses of
// the same investigation. Recording the same diagnosis twice adds no information and does distort
// any count.
//
// It is over the term alone and not over the pair (term, type): two live rows with the same term and
// a different type are not two facts, they are the same fact told twice. When a presumptive
// diagnosis is confirmed what corresponds is a 004 over the row that already exists, which is also
// the operation that leaves the trace in appDetails.
//
// No UNIQUE and no index backs it — it is a business rule of the service — and that is precisely
// why it only looks at active rows: an invented rule must not be stricter than the ones the database
// imposes, and here the database imposes none. Deactivating a diagnosis and loading it again is the
// natural correction path, and blocking it would force an ADMIN 005B to undo a USER's capture
// mistake.
//
// It only runs when the term has a value. Two free text diagnoses are distinct records by
// definition: there is no identity to compare, and comparing null against null would turn the second
// free text into a 409 for no reason.
//
// It runs AFTER the resolution, never before: what is compared is the resolved term and not the code
// that arrived, because two different codes can resolve to the same term and comparing codes would
// let through the very duplicate the rule exists to prevent
const assertNoDuplicateDiagnostic = async (
    investigationId: string,
    diagnosticTermId: string | null,
    op: string,
    lang: string,
    transaction: Transaction,
    excludedDiagnosticId?: string
) => {
    if( !diagnosticTermId ) return;

    const duplicate = await InvestigationDiagnostic.findOne({
        where: {
            investigationId,
            diagnosticTermId,
            isActive: true,
            ...( excludedDiagnosticId ? { diagnosticId: { [Op.ne]: excludedDiagnosticId } } : {} )
        },
        attributes: ['diagnosticId'],
        transaction
    });
    if( duplicate ) {
        throw new AppError(
            getMessage('investigationDiagnostic.alreadyExists', lang),
            409,
            `INVDIAG_${ op }_ALREADY_EXISTS`
        );
    }
}

// The read every operation shares to build its response. The parent include is mandatory and not
// decorative: with required: true and the isActive filter it is what implements the inherited
// visibility, so a diagnosis hanging from a retired investigation simply does not come back
const findDiagnosticWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await InvestigationDiagnostic.findOne({
        where: includeInactive ? { diagnosticId: id } : { diagnosticId: id, isActive: true },
        attributes: RESPONSE_ATTRIBUTES,
        include: [
            {
                ...INVESTIGATION_INCLUDE,
                required: true,
                where: includeInactive ? {} : { isActive: true }
            },
            DIAGNOSTIC_TERM_INCLUDE,
            DIAGNOSTIC_TYPE_INCLUDE
        ]
    });
}

// Create Investigation Diagnostic Service
// Code: ESAVI-INVDIAG-001
// Everything inside a single transaction, because the resolution against the clinical master may
// write in diagnosticTerm
const createInvestigationDiagnosticService = async (
    data: CreateInvestigationDiagnosticInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    const transaction = await sequelize.transaction();
    let createdId: string;

    try {
        // Not relaxed by canViewInactive for anybody: a retired investigation takes no new
        // diagnoses, whoever asks. It is the criterion of F31, F33 and F57 for their 001
        await findValidInvestigation(data.investigationId, '001', lang);

        await assertValidDiagnosticType(data.diagnosticTypeItemId, '001', lang, transaction);

        const resolved = await resolveDiagnosticTerm(
            data.diagnosticCode,
            data.diagnosticName,
            data.source,
            '001',
            authUser,
            lang,
            transaction
        );

        // After the resolution and never before: what is compared is the resolved term, not the code
        // that arrived. With no term nothing is checked
        await assertNoDuplicateDiagnostic(
            data.investigationId,
            resolved.diagnosticTermId,
            '001',
            lang,
            transaction
        );

        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-INVDIAG-001',
            detail: 'Investigation diagnostic created by service'
        };

        // sortOrder is deliberately absent from the create: leaving the column out of the INSERT is
        // what lets TRG_investigationDiagnostic_setSortOrder assign it, under the advisory lock that
        // keeps two concurrent inserts from colliding. Sending an explicit 0 would work by accident,
        // not by contract
        const created = await InvestigationDiagnostic.create({
            investigationId: data.investigationId,
            diagnosticTermId: resolved.diagnosticTermId,
            diagnosticRaw: resolved.diagnosticRaw,
            diagnosticDate: data.diagnosticDate ?? null,
            diagnosticTypeItemId: data.diagnosticTypeItemId ?? null,
            notes: normalizeText(data.notes),
            isActive: data.isActive ?? true,
            appDetails: [newEntry]
        }, { transaction, fields: CREATE_FIELDS });

        createdId = created.diagnosticId;

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    // Re-read so the response carries the resolved master term, the diagnosticType item and the
    // sortOrder the trigger assigned, which the create instance does not know
    const diagnostic = await findDiagnosticWithRelations(createdId, true);
    return diagnostic ? toInvestigationDiagnosticResponse(diagnostic) : null;
}

// Get Active Investigation Diagnostics By Investigation Service
// Code: ESAVI-INVDIAG-002A
// The listing is entered by the foreign key and never by /: a diagnosis does not exist without its
// investigation, and a global listing has no reader.
//
// Ordered by sortOrder ascending, which is the whole point of the column, and with no filter at all
// — not by diagnosticTypeItemId, not by date range, not by term. Those are out of the scope of this
// spec: the list of one investigation is three or four rows and the client filters in memory
const getInvestigationDiagnosticsByInvestigationService = async (
    investigationId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await assertInvestigationIsVisible(investigationId, '002A', lang, canViewInactive);

    const diagnostics = await InvestigationDiagnostic.findAndCountAll({
        where: { investigationId, isActive: true },
        attributes: RESPONSE_ATTRIBUTES,
        include: [DIAGNOSTIC_TERM_INCLUDE, DIAGNOSTIC_TYPE_INCLUDE],
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });

    return {
        count: diagnostics.count,
        rows: diagnostics.rows.map(toInvestigationDiagnosticResponse)
    };
}

// Get All Investigation Diagnostics By Investigation Service - For Admin
// Code: ESAVI-INVDIAG-002B
// The same listing as 002A without the isActive filter: it is the only door to a diagnosis that was
// retired, and therefore the entry point of whoever is going to reactivate or purge it. It is also
// where the 006 sends anybody who needs to see inactive rows, since no admin variant of that
// operation is declared.
//
// paranoid: false is declarative here — the model is not paranoid, so deletedAt is a plain column
// and no scope would hide the sealed rows — and it is written for the same reason
// entityActivation.service.ts:21 writes it: the intent is to see everything, including what a 005A
// sealed. Those are exactly the rows IX_investigationDiagnostic_investigation exists for: the
// partial unique index leaves them out.
//
// The parent guard still applies: an ADMIN sees inactive diagnoses, not the diagnoses of an inactive
// investigation
const getAllInvestigationDiagnosticsByInvestigationService = async (
    investigationId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await assertInvestigationIsVisible(investigationId, '002B', lang, canViewInactive);

    const diagnostics = await InvestigationDiagnostic.findAndCountAll({
        where: { investigationId },
        attributes: RESPONSE_ATTRIBUTES,
        include: [DIAGNOSTIC_TERM_INCLUDE, DIAGNOSTIC_TYPE_INCLUDE],
        order: [['sortOrder', 'ASC']],
        paranoid: false,
        limit,
        offset
    });

    return {
        count: diagnostics.count,
        rows: diagnostics.rows.map(toInvestigationDiagnosticResponse)
    };
}

export {
    createInvestigationDiagnosticService,
    getInvestigationDiagnosticsByInvestigationService,
    getAllInvestigationDiagnosticsByInvestigationService
};
