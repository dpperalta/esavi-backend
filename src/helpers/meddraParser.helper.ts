import { ParsedDiagnosticTermRow, RejectedDiagnosticTermRow } from '../types/diagnosticTerm/diagnosticTerm.types';
import { toConstantCase } from './stringHandling.helper';

// varchar limits of the diagnosticTerm DDL. Filtering here is what keeps one oversized line from
// blowing up the whole batch it travels in.
const MAX_CODE_LENGTH = 100;
const MAX_NAME_LENGTH = 500;

// Positions read out of the eleven the MedDRA .asc carries — zero-based indexes of the 1-based
// positions the spec names. llt_currency is the tenth field of llt.asc
// (llt_code, llt_name, pt_code, llt_whoart_code, llt_harts_code, llt_costart_sym, llt_icd9_code,
// llt_icd9cm_code, llt_icd10_code, llt_currency, llt_jart_code), followed by the closing `$`.
// The rest — pt_code and the cross-coding fields — are ignored: diagnosticTerm is a flat table and
// storing a pt_code with no table to resolve it would be storing an orphan number.
const CODE_POSITION = 0;
const NAME_POSITION = 1;
const CURRENCY_POSITION = 9;

// The raw line kept in the report is trimmed so a malformed file cannot inflate the response.
const MAX_RAW_LENGTH = 200;

export interface ParsedMeddraFile {
    rows: ParsedDiagnosticTermRow[];
    rejected: RejectedDiagnosticTermRow[];
}

/**
 * Parses a positional MedDRA .asc file — fields separated by `$`, one term per line.
 * Pure function: it does not touch the database and knows nothing about source or termGroup,
 * which are decided by the caller.
 *
 * A rejected line never aborts the parse; it is counted and the file keeps going.
 */
export const parseMeddraAscFile = ( buffer: Buffer, encoding: 'utf8' | 'latin1' = 'utf8' ): ParsedMeddraFile => {
    const rows: ParsedDiagnosticTermRow[] = [];
    const rejected: RejectedDiagnosticTermRow[] = [];
    // First appearance wins: the file is read top to bottom and a repeated code is a defect of the
    // file, not a correction of it.
    const seenCodes = new Set<string>();

    const content = buffer.toString(encoding);
    const lines = content.split(/\r?\n/);

    lines.forEach(( rawLine, index ) => {
        const line = index + 1;

        // Blank lines are not read and not invalid: they are nothing.
        if( rawLine.trim().length === 0 ) {
            return;
        }

        const reject = ( reason: RejectedDiagnosticTermRow['reason'] ): void => {
            rejected.push({
                line,
                reason,
                raw: rawLine.slice(0, MAX_RAW_LENGTH)
            });
        };

        const fields = rawLine.split('$');

        if( fields.length < 2 ) {
            return reject('MISSING_FIELDS');
        }

        const rawCode = ( fields[CODE_POSITION] ?? '' ).trim();
        // A dictionary term is quoted data: trim only, never toTitleCase.
        const name = ( fields[NAME_POSITION] ?? '' ).trim();

        if( rawCode.length === 0 ) {
            return reject('EMPTY_CODE');
        }

        if( name.length === 0 ) {
            return reject('EMPTY_NAME');
        }

        // Same normalization as ESAVI-DIAGTERM-001 and ESAVI-DIAGTERM-006, or the catalogue would
        // end up with two representations of the same term.
        const code = toConstantCase(rawCode);

        if( code.length > MAX_CODE_LENGTH ) {
            return reject('CODE_TOO_LONG');
        }

        if( name.length > MAX_NAME_LENGTH ) {
            return reject('NAME_TOO_LONG');
        }

        if( seenCodes.has(code) ) {
            return reject('DUPLICATE_IN_FILE');
        }

        // llt_currency: 'N' means withdrawn by MedDRA. Anything else — including the absence of the
        // field — means current.
        const currency = ( fields[CURRENCY_POSITION] ?? '' ).trim().toUpperCase();
        const isActive = currency !== 'N';

        seenCodes.add(code);
        rows.push({ line, code, name, isActive });
    });

    return { rows, rejected };
}
