// Age unit codes, in toConstantCase because that is how catalogItem.service.ts stores every code.
// The service resolves them against the catalogType whose code is `ageUnit`
export type AgeUnitCode = 'YEARS' | 'MONTHS' | 'DAYS';

export interface AgeAtEvent {
    age: number;
    unitCode: AgeUnitCode;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// Reads a date column into its calendar parts. DATEONLY columns come back as 'YYYY-MM-DD'
// strings, but a Date built from such a string is UTC midnight, so the UTC getters are the
// ones that give back the day that was written — the local getters would shift it a day west
// of Greenwich. Returns null when the value is absent or not a readable date
const toCalendarParts = (value: string | Date | null | undefined): { year: number, month: number, day: number } | null => {
    if( value === null || value === undefined ) {
        return null;
    }
    if( value instanceof Date ) {
        if( Number.isNaN(value.getTime()) ) {
            return null;
        }
        return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
    }
    const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
    if( !isoDate ) {
        return null;
    }
    const [ , year, month, day ] = isoDate;
    return { year: parseInt(year), month: parseInt(month), day: parseInt(day) };
}

// Resolve Age At Event
// Calendar arithmetic over completed periods, never a division of milliseconds: dividing by
// 365 drifts a day on leap years and by 30 on every month that is not 30 days long, exactly at
// the borders where the number gets reviewed. Returns null when either date is missing, which
// is the signal for the service to fall back to what the client sent. Throws when the event
// precedes the birth: the caller turns that into a 409, since the conflict is between two rows
// that already exist and not between the fields the client typed
const resolveAgeAtEvent = (
    birthDate: string | Date | null | undefined,
    eventDate: string | Date | null | undefined
): AgeAtEvent | null => {
    const birth = toCalendarParts(birthDate);
    const event = toCalendarParts(eventDate);
    if( !birth || !event ) {
        return null;
    }

    const birthUtc = Date.UTC(birth.year, birth.month - 1, birth.day);
    const eventUtc = Date.UTC(event.year, event.month - 1, event.day);
    if( eventUtc < birthUtc ) {
        throw new Error('resolveAgeAtEvent: the event date cannot precede the birth date');
    }

    // Completed months: the calendar difference minus the last month if the day of the month
    // has not come round yet. This is what makes 29-Feb to 28-Feb of the next year eleven
    // months and not a year
    const completedMonths = (event.year - birth.year) * 12 + (event.month - birth.month) - (event.day < birth.day ? 1 : 0);

    if( completedMonths >= 12 ) {
        return { age: Math.floor(completedMonths / 12), unitCode: 'YEARS' };
    }
    if( completedMonths >= 1 ) {
        return { age: completedMonths, unitCode: 'MONTHS' };
    }
    // Below one completed month the unit is elapsed days, which never exceeds 30 — both
    // operands are UTC midnights, so the subtraction carries no daylight saving offset
    return { age: Math.round((eventUtc - birthUtc) / MILLISECONDS_PER_DAY), unitCode: 'DAYS' };
}

export {
    resolveAgeAtEvent
}
