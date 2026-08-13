import { DiagnosticTerm } from '../models';
import { AppError, getMessage, toConstantCase } from '../helpers';
import { AppDetails, AuthUser, CreateDiagnosticTermInput } from '../types';

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

export {
    createDiagnosticTermService
}
