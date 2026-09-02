import { Op } from 'sequelize';
import { escapeLike } from './stringHandling.helper';

// Build one Op.iLike condition per column for a single search value, already escaped against the
// two LIKE wildcards. Returns [] when value is absent so callers can spread it into an Op.or
// without an empty-string pattern ever reaching the query
export const buildTextSearchConditions = (value: string | undefined, columns: string[]): any[] => {
    if( !value ) {
        return [];
    }
    const pattern = `%${ escapeLike(value.trim()) }%`;
    return columns.map((column) => ({ [column]: { [Op.iLike]: pattern } }));
}
