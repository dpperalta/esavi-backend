import { CreationAttributes, Op, Transaction, WhereOptions } from 'sequelize';
import { sequelize } from '../database/connection';
import { DiagnosticTerm } from '../models';
import { AppError, buildDifferentialUpdate, buildTextSearchConditions, esaviLog, getMessage, parseMeddraAscFile, toConstantCase } from '../helpers';
import {
    AppDetails,
    AuthUser,
    CreateDiagnosticTermInput,
    DiagnosticTermImportReport,
    DiagnosticTermListFilters,
    ImportDiagnosticTermsInput,
    ParsedDiagnosticTermRow
} from '../types';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// 90 000 rows in batches of 1000 are 90 iterations of two queries. The batch is the unit of the
// transaction, so it is also the unit of what survives a failure halfway through
const IMPORT_BATCH_SIZE = 1000;

// The declared use case is LLT over MEDDRA; pt.asc, hlt.asc and soc.asc share the first two
// positions and load through the same endpoint by changing the field
const DEFAULT_IMPORT_TERM_GROUP = 'LLT';

// The counters stay exact; only the sample of rejected lines is trimmed
const MAX_REPORTED_IMPORT_ERRORS = 20;

// Shared by both listings. name and code are the canonical parameters (SPEC F52), joined with
// Op.or; search is the legacy alias and feeds both columns at once. name/code explicit win over
// the alias when both arrive. source and termGroup are exact equality — partial search over them
// is out of this spec's scope
const buildDiagnosticTermWhere = (filters: DiagnosticTermListFilters): WhereOptions => {
    const where: Record<string, unknown> = {};
    const textConditions = [
        ...buildTextSearchConditions(filters.name ?? filters.search, ['name']),
        ...buildTextSearchConditions(filters.code ?? filters.search, ['code'])
    ];
    if (textConditions.length > 0) {
        where[Op.or as unknown as string] = textConditions;
    }
    if (filters.source) {
        where.source = filters.source;
    }
    if (filters.termGroup) {
        where.termGroup = filters.termGroup.trim();
    }
    // First JSONB key filter of the repository. It only ever arrives from the admin listing: the
    // public controller does not read reviewStatus from the query, so the key never gets here
    if (filters.reviewStatus) {
        where['metadata.reviewStatus'] = filters.reviewStatus.trim();
    }
    return where;
}

// ESAVI-DIAGTERM-001 - Create Diagnostic Term Service
const createDiagnosticTermService = async (data: CreateDiagnosticTermInput, authUser: AuthUser | undefined, lang: string) => {
    // source defaults to LOCAL, the same default the DDL declares
    const source = data.source ?? 'LOCAL';
    // The code is normalized before anything else, so the uniqueness check and the stored value
    // are the same string. ESAVI-DIAGTERM-006 normalizes identically or it would never find
    // what this service saved
    const code = toConstantCase(data.code.trim());
    // Uniqueness is by the (source, code) pair, which is what UQ_diagnosticTerm_source_code
    // declares: the same code may legitimately exist in two dictionaries. The check does not
    // filter by isActive — an inactive row still occupies the pair and the constraint still fires
    const existingTerm = await DiagnosticTerm.findOne({
        where: { source, code },
        attributes: ['diagnosticTermId']
    });
    if (existingTerm) {
        throw new AppError(getMessage('diagnosticTerm.codeExists', lang, { code, source }), 409, 'DIAGTERM_001_CODE_EXISTS');
    }
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-DIAGTERM-001',
        detail: 'Diagnostic term created by service'
    };
    // metadata is written empty: an administrative entry carries no markers. The autoCreated,
    // createdFrom and reviewStatus keys belong to implicit resolution, not to this operation
    const newDiagnosticTerm = await DiagnosticTerm.create({
        source,
        code,
        // Only trimmed, never toTitleCase: a dictionary term is quoted data, not a proper name the
        // application embellishes. toTitleCase would turn 'Dolor de Cabeza' into 'Dolor De Cabeza'
        // and destroy the official capitalization of any imported term
        name: data.name.trim(),
        termGroup: data.termGroup ? data.termGroup.trim() : null,
        metadata: {},
        isActive: data.isActive !== undefined ? data.isActive : true,
        appDetails: [newEntry]
    });
    return newDiagnosticTerm;
}

// ESAVI-DIAGTERM-002A - Get Active Diagnostic Terms Service
const getActiveDiagnosticTermsService = async (filters: DiagnosticTermListFilters, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const diagnosticTerms = await DiagnosticTerm.findAndCountAll({
        where: {
            ...buildDiagnosticTermWhere(filters),
            isActive: true
        },
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        order: [['name', 'ASC']],
        limit,
        offset
    });
    return diagnosticTerms;
}

// ESAVI-DIAGTERM-002B - Get All Diagnostic Terms Service (including inactive) - For Admin
const getAllDiagnosticTermsService = async (filters: DiagnosticTermListFilters, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const diagnosticTerms = await DiagnosticTerm.findAndCountAll({
        where: buildDiagnosticTermWhere(filters),
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        order: [['name', 'ASC']],
        limit,
        offset
    });
    return diagnosticTerms;
}

// ESAVI-DIAGTERM-003 - Get Diagnostic Term by ID Service
const getDiagnosticTermByIdService = async (id: string, lang: string, includeInactive: boolean = false) => {
    const whereClause = includeInactive ? { diagnosticTermId: id } : { diagnosticTermId: id, isActive: true };
    // No includes: the entity has no associations at all, so there is nothing to join
    const diagnosticTerm = await DiagnosticTerm.findOne({
        where: whereClause,
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] }
    });
    if (!diagnosticTerm) {
        throw new AppError(getMessage('diagnosticTerm.notFound', lang), 404, 'DIAGTERM_003_NOT_FOUND');
    }
    return diagnosticTerm;
}

// ESAVI-DIAGTERM-004 - Update Diagnostic Term Service
const updateDiagnosticTermService = async (id: string, data: Partial<CreateDiagnosticTermInput>, authUser: AuthUser | undefined, lang: string) => {
    const { userId } = authUser || {};
    const { code, name, termGroup, reviewStatus } = data;
    const diagnosticTerm = await DiagnosticTerm.findByPk(id);
    let updatedDiagnosticTerm = diagnosticTerm;
    if (!diagnosticTerm) {
        throw new AppError(getMessage('diagnosticTerm.notFound', lang), 404, 'DIAGTERM_004_NOT_FOUND');
    }
    // Uniqueness runs before the diff and independently of it: an occupied code is a 409 even when
    // the rest of the body changes nothing. The source of the pair is always the stored one, never
    // the body, because source is immutable. Excluding the own id is what lets a client resend its
    // own code without colliding with itself
    const targetCode = code ? toConstantCase(code.trim()) : undefined;
    if (targetCode) {
        const existingTerm = await DiagnosticTerm.findOne({
            where: {
                source: diagnosticTerm.source,
                code: targetCode,
                diagnosticTermId: { [Op.ne]: id }
            },
            attributes: ['diagnosticTermId']
        });
        if (existingTerm) {
            throw new AppError(getMessage('diagnosticTerm.codeExists', lang, { code: targetCode, source: diagnosticTerm.source }), 409, 'DIAGTERM_004_CODE_EXISTS');
        }
    }
    const currentAppDetails = Array.isArray(diagnosticTerm.appDetails) ? diagnosticTerm.appDetails : [];
    const storedMetadata = (diagnosticTerm.metadata ?? {}) as Record<string, unknown>;
    // `stored` is the whole row, which is the precondition of the helper: a narrowed `attributes`
    // would read back undefined for the columns it left out and every comparison would count as a
    // change. source and isActive are not candidates — the first is immutable, the second is
    // governed by 005A and 005B
    const stored = diagnosticTerm.get({ plain: true }) as Record<string, unknown>;
    const objectToUpdate = buildDifferentialUpdate(stored, {
        code: targetCode,
        // Only trimmed, never toTitleCase, for the same reason as the create
        name: name ? name.trim() : undefined,
        // Nullable: null is a value that empties the column, undefined means the key did not travel
        termGroup: termGroup !== undefined ? (termGroup?.trim() ?? null) : undefined,
        // Derived from a flat field: reviewStatus is merged over the stored metadata so autoCreated
        // and createdFrom survive. Resending the same value produces an identical object and the
        // helper, which compares objects with JSON.stringify, detects no change
        metadata: reviewStatus !== undefined ? { ...storedMetadata, reviewStatus } : undefined
    });
    // Nothing changed: no UPDATE, no updatedAt and no audit entry
    if (Object.keys(objectToUpdate).length > 0) {
        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: userId || 'undefined',
            method: 'ESAVI-DIAGTERM-004',
            detail: 'Diagnostic term updated by service'
        };
        updatedDiagnosticTerm = await diagnosticTerm.update({
            ...objectToUpdate,
            updatedAt: new Date(),
            appDetails: [
                ...currentAppDetails,
                newEntry
            ]
        }, { returning: true });
    }
    return updatedDiagnosticTerm;
}

// ESAVI-DIAGTERM-005A / ESAVI-DIAGTERM-005B - Set Diagnostic Term Activation Service
// Not a differential update: these are writes with an intention of their own. They record a state
// fact, so they go through setEntityActiveStatusService and never through buildDifferentialUpdate.
// The where filters by the primary key alone: no incoming foreign key is checked, because this is
// a logical delete — the ON DELETE RESTRICT constraints of the three child tables never fire, and
// an inactive term keeps being referenced by design. Deactivating means "stop offering it in the
// autocomplete", not "stop existing"
const setDiagnosticTermActivationService = async (id: string, authUser: AuthUser | undefined, lang: string, isActive: boolean = true) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        const diagnosticTerm = await setEntityActiveStatusService({
            model: DiagnosticTerm,
            where: { diagnosticTermId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('diagnosticTerm.notFound', lang),
            notFoundCode: `DIAGTERM_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`diagnosticTerm.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `DIAGTERM_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-DIAGTERM-${ op }`,
                detail: `DiagnosticTerm ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return diagnosticTerm;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// ESAVI-DIAGTERM-007 - Import Diagnostic Terms Service
// Bulk import of a MedDRA .asc dictionary. It writes on diagnosticTerm and on nothing else: the
// three incoming foreign keys are never touched, not even when a row is deactivated — a
// notificationEvent pointing at a withdrawn LLT keeps pointing at it, which is exactly what a
// historical reference means.
const importDiagnosticTermsService = async (
    fileBuffer: Buffer | undefined,
    data: ImportDiagnosticTermsInput,
    authUser: AuthUser | undefined,
    lang: string
): Promise<DiagnosticTermImportReport> => {
    // Phase 1 — reception. The size limit was already enforced by the upload middleware, so the
    // only thing left to check here is that a file arrived at all
    if (!fileBuffer || fileBuffer.length === 0) {
        throw new AppError(getMessage('diagnosticTerm.fileRequired', lang), 400, 'DIAGTERM_007_FILE_REQUIRED');
    }
    const source = data.source ?? 'MEDDRA';
    const termGroup = data.termGroup ? data.termGroup.trim() : DEFAULT_IMPORT_TERM_GROUP;
    const dictionaryVersion = data.dictionaryVersion ? data.dictionaryVersion.trim() : undefined;
    const encoding = data.encoding ?? 'utf8';
    const dryRun = data.dryRun ?? false;
    const userId = authUser?.userId || 'undefined';

    // Phase 2 — parsing. A rejected line never aborts the process; it is counted and the file goes on
    const { rows, rejected } = parseMeddraAscFile(fileBuffer, encoding);
    // Blank lines are neither read nor invalid, so every counted line ended up in one of the two lists
    const read = rows.length + rejected.length;
    const duplicated = rejected.filter(row => row.reason === 'DUPLICATE_IN_FILE').length;
    const invalid = rejected.length - duplicated;
    // The only content problem that cuts the operation, and it cuts before writing: an empty file,
    // a binary one or one with another separator produces no rows at all
    if (rows.length === 0) {
        throw new AppError(getMessage('diagnosticTerm.fileInvalid', lang), 400, 'DIAGTERM_007_FILE_INVALID');
    }

    const importedAt = new Date();
    // The same for every inserted row, so it is built once. reviewStatus APPROVED and autoCreated
    // false are deliberate and the opposite of what 006 writes: a term coming from the official
    // dictionary is not pending anyone's review. dictionaryVersion is omitted rather than stored
    // as null when it did not travel in the body
    const importMetadata: Record<string, unknown> = {
        importedFrom: source,
        importedAt,
        ...(dictionaryVersion ? { dictionaryVersion } : {}),
        reviewStatus: 'APPROVED',
        autoCreated: false
    };
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    // Phase 3 — one batch at a time. Reading the existing rows and computing the diff happens the
    // same way in both modes; `transaction` is undefined on a dry run, where nothing is written
    const processBatch = async (batch: ParsedDiagnosticTermRow[], transaction?: Transaction): Promise<void> => {
        // The whole row, with no narrowed `attributes` and no isActive filter: it is the
        // precondition of buildDifferentialUpdate, and an inactive row still occupies the pair
        const existingTerms = await DiagnosticTerm.findAll({
            where: {
                source,
                code: { [Op.in]: batch.map(row => row.code) }
            },
            transaction
        });
        const existingByCode = new Map(existingTerms.map(term => [term.code as string, term]));
        const termsToInsert: CreationAttributes<DiagnosticTerm>[] = [];

        for (const row of batch) {
            const storedTerm = existingByCode.get(row.code);
            if (!storedTerm) {
                // Phase 4 — insertion
                termsToInsert.push({
                    source,
                    code: row.code,
                    name: row.name,
                    termGroup,
                    isActive: row.isActive,
                    deletedAt: row.isActive ? null : importedAt,
                    metadata: importMetadata,
                    appDetails: [{
                        createdAt: new Date(),
                        user: userId,
                        method: 'ESAVI-DIAGTERM-007',
                        detail: 'Diagnostic term created by bulk import service'
                    }]
                });
                continue;
            }
            const stored = storedTerm.get({ plain: true }) as Record<string, unknown>;
            // name, termGroup and isActive enter with no presence check: there is no client body to
            // ask, the file is the complete source of the three, and it is the helper that decides
            // whether there is an UPDATE. source and code stay out — they are the search key.
            // metadata is deliberately not rewritten: reimporting must not erase the autoCreated or
            // createdFrom of a term born out of 006 that later showed up in the dictionary
            const objectToUpdate = buildDifferentialUpdate(stored, {
                name: row.name,
                termGroup,
                isActive: row.isActive
            });
            // Nothing changed: no UPDATE, no updatedAt, no appDetails entry and no sysDetails event
            if (Object.keys(objectToUpdate).length === 0) {
                unchanged++;
                continue;
            }
            // A conditioned derivative, not a candidate of its own: it is computed after the diff and
            // only when isActive really changed, so an unchanged currency never touches the column
            if (objectToUpdate.isActive !== undefined) {
                objectToUpdate.deletedAt = objectToUpdate.isActive ? null : new Date();
            }
            updated++;
            if (!dryRun) {
                const currentAppDetails = Array.isArray(storedTerm.appDetails) ? storedTerm.appDetails : [];
                const newEntry: AppDetails = {
                    createdAt: new Date(),
                    user: userId,
                    method: 'ESAVI-DIAGTERM-007',
                    detail: 'Diagnostic term updated by bulk import service'
                };
                await storedTerm.update({
                    ...objectToUpdate,
                    updatedAt: new Date(),
                    appDetails: [
                        ...currentAppDetails,
                        newEntry
                    ]
                }, { transaction });
            }
        }

        if (termsToInsert.length > 0) {
            inserted += termsToInsert.length;
            // No updateOnDuplicate and no ignoreDuplicates: the previous SELECT already told apart
            // what is new, and updateOnDuplicate would overwrite appDetails and metadata of the
            // existing rows and write even when nothing changed
            if (!dryRun) {
                await DiagnosticTerm.bulkCreate(termsToInsert, { transaction });
            }
        }
    }

    for (let index = 0; index < rows.length; index += IMPORT_BATCH_SIZE) {
        const batch = rows.slice(index, index + IMPORT_BATCH_SIZE);
        // A dry run opens no transaction at all: there is nothing to roll back
        if (dryRun) {
            await processBatch(batch);
            continue;
        }
        // One transaction per batch instead of one for the whole file: a single transaction over
        // 90 000 rows holds locks for minutes and throws away the whole job if it fails near the end.
        // By batches, a failure leaves the previous ones committed, and reimporting is idempotent
        const transaction = await sequelize.transaction();
        try {
            await processBatch(batch, transaction);
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            // No retry and no re-read, unlike 006: a unique constraint violation here means two
            // simultaneous imports, which is an operation error and is better made visible
            esaviLog(`ESAVI-DIAGTERM-007 - Batch starting at line ${ batch[0].line } failed and was rolled back`, 'error');
            throw new AppError(getMessage('diagnosticTerm.importedFailed', lang), 500, 'DIAGTERM_007_IMPORT_FAILED', error);
        }
    }

    // Phase 5 — report. errors is trimmed to the first 20 entries: a malformed file would produce
    // 90 000 and the response would weigh more than the request. The counters are the real totals
    return {
        read,
        inserted,
        updated,
        unchanged,
        invalid,
        duplicated,
        dryRun,
        source,
        termGroup,
        errors: rejected.slice(0, MAX_REPORTED_IMPORT_ERRORS)
    };
}

export {
    createDiagnosticTermService,
    getActiveDiagnosticTermsService,
    getAllDiagnosticTermsService,
    getDiagnosticTermByIdService,
    updateDiagnosticTermService,
    setDiagnosticTermActivationService,
    importDiagnosticTermsService
}
