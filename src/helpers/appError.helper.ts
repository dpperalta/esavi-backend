export class AppError extends Error {
    statusCode: number;
    code?: string;
    originalError?: unknown;

    constructor(message: string, statusCode: number = 500, code?: string, originalError?: unknown) {
        super(message);
        this.name = "APP_ERROR";
        this.statusCode = statusCode;
        this.code = code;
        this.originalError = originalError;

        Object.setPrototypeOf(this, AppError.prototype);
    }
}