import { AuthUser } from '../user/user.types';

declare global {
    namespace Express {
        export interface Request {
            // Always populated: languageMiddleware runs before every route in app.ts.
            lang: string;
            user?: AuthUser;
        }
    }
}

export {};
