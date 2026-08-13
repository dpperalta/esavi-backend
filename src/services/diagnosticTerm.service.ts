import { Op, WhereOptions } from 'sequelize';
import { DiagnosticTerm } from '../models';
import { AppError, getMessage, toConstantCase } from '../helpers';
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
        order: [['name', 'ASC']],
        limit,
        offset
    });
    return diagnosticTerms;
}

export {
    createDiagnosticTermService,
    getActiveDiagnosticTermsService,
    getAllDiagnosticTermsService
}
