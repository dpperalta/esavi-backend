import { AuthUser } from '../user/user.types';

declare global {
    namespace Express {
        export interface Request {
            lang?: string;
            user?: AuthUser;
        }
    }
}

export {};
