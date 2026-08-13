import { Op, WhereOptions } from 'sequelize';
import { DiagnosticTerm } from '../models';
import { AppError, buildDifferentialUpdate, getMessage, toConstantCase } from '../helpers';
import { AppDetails, AuthUser, CreateDiagnosticTermInput, DiagnosticTermListFilters } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// Shared by both listings. search is the first Op.iLike of the repository and stays deliberately
// confined to name and to these two services: the real use case of the catalog is the autocomplete
// of the notification form, and a term is looked up by how it reads, not by its code. source and
// termGroup are exact equality — partial search over them is out of this spec's scope
const buildDiagnosticTermWhere = (filters: DiagnosticTermListFilters): WhereOptions => {
    const where: Record<string, unknown> = {};
    if (filters.search) {
        where.name = { [Op.iLike]: `%${filters.search.trim()}%` };
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

export {
    createDiagnosticTermService,
    getActiveDiagnosticTermsService,
    getAllDiagnosticTermsService,
    getDiagnosticTermByIdService,
    updateDiagnosticTermService
}
