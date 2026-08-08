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

// Case Code Prefix — <localCode>-DDMMYYYY-, the part every code minted by one facility on one
// registration date shares. The service matches on it to read the last sequence back
const caseCodePrefix = (localCode: string, registrationDate: string): string => {
    const prefix = localCode?.trim();
    if( !prefix ) {
        throw new Error('caseCodePrefix: localCode is required to build a case code');
    }

    const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(registrationDate));
    if( !isoDate ) {
        throw new Error(`caseCodePrefix: registrationDate must be an ISO date (YYYY-MM-DD), received '${ registrationDate }'`);
    }
    const [ , year, month, day ] = isoDate;

    return `${ prefix }-${ day }${ month }${ year }-`;
}

// Format Case Code — <localCode>-DDMMYYYY-NNNN, e.g. HOSP-06082026-0001
// The date is the one the case is registered on, not the date it reports: the code is minted once
// and never changes again, so it cannot depend on a field the user can still edit.
// Pure: it neither reads the database nor computes the sequence. The sequence is
// resolved by the service, which is the one holding the transaction.
const formatCaseCode = (localCode: string, registrationDate: string, sequence: number): string => {
    const prefix = caseCodePrefix(localCode, registrationDate);

    // Overflowing the fixed width would break the lexicographic ordering the sequence relies on
    if( !Number.isInteger(sequence) || sequence < 1 || sequence > CASE_CODE_MAX_SEQUENCE ) {
        throw new Error(`formatCaseCode: sequence must be an integer between 1 and ${ CASE_CODE_MAX_SEQUENCE }, received '${ sequence }'`);
    }

    return `${ prefix }${ String(sequence).padStart(CASE_CODE_SEQUENCE_LENGTH, '0') }`;
}

export {
    generateHealthSystemCode,
    caseCodePrefix,
    formatCaseCode,
    HEALTH_SYSTEM_CODE_ALPHABET,
    HEALTH_SYSTEM_CODE_LENGTH,
    CASE_CODE_SEQUENCE_LENGTH,
    CASE_CODE_MAX_SEQUENCE
}
