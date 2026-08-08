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

export {
    generateHealthSystemCode,
    HEALTH_SYSTEM_CODE_ALPHABET,
    HEALTH_SYSTEM_CODE_LENGTH
}
