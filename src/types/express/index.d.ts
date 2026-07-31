
declare global{
    namespace Express {
        export interface Request {
            lang?: string;
            user?: {
                userId: string;
                email: string;
                displayName: string;
                roles?: Array<{
                    roleId?: string;
                    name: string;
                    code?: string;
                    level: number;
                }>;
            };
        }
    } 
}

export {};