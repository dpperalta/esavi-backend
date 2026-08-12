// Differential update — the single place where "did this field change?" is answered.
//
// A PUT is not "save what I send", it is "leave the record in this state": a body that carries
// the same values the row already holds is not a change, and writing it back fills appDetails
// with entries that record nothing and hides the real ones among them. The same UPDATE also
// fires TRG_<table>_setSysDetails, which bumps sysDetails.version and appends to its auditTrail,
// so every write with no change costs two audit trails, not one.
//
// PRECONDITION — `stored` must be the whole row, read with `instance.get({ plain: true })`.
// An instance read with narrowed `attributes` reads back `undefined` for the columns it left
// out, and every comparison against `undefined` counts as a change, so the service would go
// back to writing on every request without any test noticing.
//
// The values in `candidates` come already normalized by the service (toConstantCase,
// toTitleCase, .trim(), plain text for the encrypted columns): the helper does not know which
// field is a code and which one a name, and teaching it would make it a second home for the
// normalization convention. Encrypted fields are compared decrypted and encrypted afterwards,
// over the keys this function returned.

// Matches the 'YYYY-MM-DD' that a DATEONLY column reads back as, and the prefix of any ISO
// string a client may send for the same column
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_ONLY_PREFIX = /^\d{4}-\d{2}-\d{2}/;

// Numbers and the numeric strings `pg` returns for DECIMAL columns, which have no type parser
// configured in this repository: latitude reads back as '-0.2299000' and arrives as -0.2299
const isNumericValue = (value: unknown): boolean => {
    if( typeof value === 'number' ) {
        return Number.isFinite(value);
    }
    if( typeof value === 'string' ) {
        return value.trim() !== '' && Number.isFinite(Number(value));
    }
    return false;
}

const isDateOnlyString = (value: unknown): boolean => {
    return typeof value === 'string' && DATE_ONLY.test(value.trim());
}

const isDateLikeString = (value: unknown): boolean => {
    return typeof value === 'string' && DATE_ONLY_PREFIX.test(value.trim());
}

// The comparison rules, in cascade. Order matters: a Date instance is also an object, and a
// DATEONLY string is also a string
const isSameValue = (stored: unknown, candidate: unknown): boolean => {
    // Identical primitives, the same reference, and null against null
    if( stored === candidate ) {
        return true;
    }
    // Past that point one side being null or absent means the other one carries a value, and
    // that is always a change — including the key `stored` does not have at all
    if( stored === null || stored === undefined || candidate === null || candidate === undefined ) {
        return false;
    }
    // DATE columns come back as Date instances; the body carries an ISO string
    if( stored instanceof Date || candidate instanceof Date ) {
        return new Date(stored as string | Date).getTime() === new Date(candidate as string | Date).getTime();
    }
    // DATEONLY columns come back as a bare 'YYYY-MM-DD', so only the calendar day is compared
    if( ( isDateOnlyString(stored) && isDateLikeString(candidate) ) || ( isDateLikeString(stored) && isDateOnlyString(candidate) ) ) {
        return String(stored).slice(0, 10) === String(candidate).slice(0, 10);
    }
    // DECIMAL columns: '-0.2299000' and -0.2299 are the same coordinate
    if( isNumericValue(stored) && isNumericValue(candidate) ) {
        return Number(stored) === Number(candidate);
    }
    // Objects and arrays — JSONB columns, mostly
    if( typeof stored === 'object' && typeof candidate === 'object' ) {
        return JSON.stringify(stored) === JSON.stringify(candidate);
    }
    return false;
}

// Build Differential Update
// Returns only the keys of `candidates` whose value differs from the stored one. Three rules:
// a key holding `undefined` is discarded, because that is how the service says "it did not
// travel in the body" — which is why `null` and `undefined` are not interchangeable here, a
// `null` is a value that arrived and is a change when the stored one was not null; a key equal
// to the stored value is discarded; the rest are kept. The caller's only remaining control line
// is `if( Object.keys(changes).length === 0 )`, which is where it returns without writing
const buildDifferentialUpdate = (
    stored: Record<string, unknown>,
    candidates: Record<string, unknown>
): Record<string, unknown> => {
    const changes: Record<string, unknown> = {};
    for( const [ field, value ] of Object.entries(candidates) ) {
        if( value === undefined ) {
            continue;
        }
        if( isSameValue(stored[field], value) ) {
            continue;
        }
        changes[field] = value;
    }
    return changes;
}

export {
    buildDifferentialUpdate
}
