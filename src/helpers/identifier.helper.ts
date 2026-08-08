import crypto from 'crypto';

// Crockford Base32: no I, L, O or U, so the code survives being dictated
// over the phone or copied off a printed sheet
const HEALTH_SYSTEM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const HEALTH_SYSTEM_CODE_LENGTH = 12;

// Generate Health System Code
// The alphabet holds exactly 32 symbols and 32 divides 256, so every byte value maps
// to one symbol the same number of times: `byte % 32` is already uniform and rejection
// sampling would only skew it. No database read is involved — uniqueness is not checked.
const generateHealthSystemCode = (length: number = HEALTH_SYSTEM_CODE_LENGTH): string => {
    const bytes = crypto.randomBytes(length);
    let code = '';
    for( let i = 0; i < length; i++ ) {
        code += HEALTH_SYSTEM_CODE_ALPHABET[bytes[i] % HEALTH_SYSTEM_CODE_ALPHABET.length];
    }
    return code;
}

// Four digits give 9999 cases per facility and day, far above any real volume.
// The fixed width is what makes MAX("caseCode") lexicographic match the numeric order,
// so the service can read the sequence back without parsing the string
const CASE_CODE_SEQUENCE_LENGTH = 4;
const CASE_CODE_MAX_SEQUENCE = 9999;

// Format Case Code — <localCode>-DDMMYYYY-NNNN, e.g. HOSP-06082026-0001
// Pure: it neither reads the database nor computes the sequence. The sequence is
// resolved by the service, which is the one holding the transaction.
const formatCaseCode = (localCode: string, reportDate: string, sequence: number): string => {
    const prefix = localCode?.trim();
    if( !prefix ) {
        throw new Error('formatCaseCode: localCode is required to build a case code');
    }

    const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(reportDate));
    if( !isoDate ) {
        throw new Error(`formatCaseCode: reportDate must be an ISO date (YYYY-MM-DD), received '${ reportDate }'`);
    }
    const [ , year, month, day ] = isoDate;

    // Overflowing the fixed width would break the lexicographic ordering the sequence relies on
    if( !Number.isInteger(sequence) || sequence < 1 || sequence > CASE_CODE_MAX_SEQUENCE ) {
        throw new Error(`formatCaseCode: sequence must be an integer between 1 and ${ CASE_CODE_MAX_SEQUENCE }, received '${ sequence }'`);
    }

    const paddedSequence = String(sequence).padStart(CASE_CODE_SEQUENCE_LENGTH, '0');
    return `${ prefix }-${ day }${ month }${ year }-${ paddedSequence }`;
}

export {
    generateHealthSystemCode,
    formatCaseCode,
    HEALTH_SYSTEM_CODE_ALPHABET,
    HEALTH_SYSTEM_CODE_LENGTH,
    CASE_CODE_SEQUENCE_LENGTH,
    CASE_CODE_MAX_SEQUENCE
}
