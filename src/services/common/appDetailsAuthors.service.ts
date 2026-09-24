import { applyAppDetailsAuthors, collectAppDetailsUserIds, esaviDecrypt, toPlainResponse } from '../../helpers';
import { AppUser } from '../../models';

// Resolve App Details Authors Service
// Rewrites every appDetails[].user of a response to the author's decrypted email, or null when
// the reader may not see it or the author does not resolve. At most one query per call. It never
// runs inside a write transaction: callers resolve after the commit. The result is plain data:
// a caller that reads its shape names it through R, instead of pretending it is still an instance
const resolveAppDetailsAuthorsService = async <R = unknown>(data: unknown, canViewAuthors: boolean): Promise<R> => {
    const plain = toPlainResponse(data);
    const userIds = canViewAuthors ? collectAppDetailsUserIds(plain) : [];
    const authors = new Map<string, string>();
    if( userIds.length > 0 ) {
        // No isActive filter: a deactivated user is still the author of what they did
        const users = await AppUser.findAll({
            where: { userId: userIds },
            attributes: [ 'userId', 'email' ]
        });
        for( const user of users ) {
            const email = user.getDataValue('email');
            if( typeof email === 'string' ) {
                authors.set(user.getDataValue('userId'), esaviDecrypt(email));
            }
        }
    }
    return applyAppDetailsAuthors(plain, authors) as R;
}

export {
    resolveAppDetailsAuthorsService
}
