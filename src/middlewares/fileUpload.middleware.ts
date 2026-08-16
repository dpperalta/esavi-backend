import { Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';

import { AppError } from '../helpers/appError.helper';
import { getMessage } from '../helpers/i18n.helper';
import { esaviLog } from '../helpers/esaviLogs.helper';

// A MedDRA llt.asc of a recent release is around 10 MB and a WHODrug .xlsx around 500 KB. 20 MB
// leaves room to spare for both and stops the upload before the buffer grows, which is the whole
// point of holding the file in memory. The limit is shared: every caller of this middleware gets it.
export const MAX_UPLOAD_FILE_SIZE = 20 * 1024 * 1024;

// memoryStorage: the file is parsed once and discarded. Writing it to disk would add permissions,
// temp-file cleanup and a new failure mode in exchange for nothing.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_UPLOAD_FILE_SIZE,
        files: 1
    }
});

/**
 * Per-entity wiring of the middleware. Both prefixes are mandatory: a shared upload middleware that
 * answered with another entity's messages would be worse than no message at all.
 *
 * - `i18nPrefix` is the i18n block of the entity ('diagnosticTerm', 'vaccineWhodrug'). Every entity
 *   using this middleware declares `fileTooLarge` and `fileInvalid` inside its block.
 * - `codePrefix` is the operation code without the 'ESAVI-' prefix and with an underscore
 *   ('DIAGTERM_007'), exactly as it appears in the AppError codes.
 */
interface UploadSingleFileOptions {
    i18nPrefix: string;
    codePrefix: string;
}

/**
 * Receives a single file under `fieldName` and leaves it in `req.file`.
 * Multer errors are translated here, never in the service: the limit is enforced by multer
 * before the handler runs, so the service never sees an oversized buffer.
 */
const uploadSingleFile = ( fieldName: string, { i18nPrefix, codePrefix }: UploadSingleFileOptions ) => {
    const handler = upload.single(fieldName);
    // 'DIAGTERM_007' -> 'ESAVI-DIAGTERM-007': the log carries the operation code, the AppError the
    // error code, and both are the same operation written in the two shapes the repository uses.
    const operationCode = `ESAVI-${ codePrefix.replace('_', '-') }`;

    return ( req: Request, res: Response, next: NextFunction ): void => {
        handler(req, res, ( error: unknown ) => {
            if( !error ) {
                return next();
            }

            if( error instanceof MulterError ) {
                if( error.code === 'LIMIT_FILE_SIZE' ) {
                    esaviLog(`${ operationCode } - Uploaded file exceeds the allowed size`, 'warn');
                    return next(new AppError(
                        getMessage(`${ i18nPrefix }.fileTooLarge`, req.lang),
                        413,
                        `${ codePrefix }_FILE_TOO_LARGE`,
                        error
                    ));
                }

                esaviLog(`${ operationCode } - Upload rejected by multer: ${ error.code }`, 'error');
                return next(new AppError(
                    getMessage(`${ i18nPrefix }.fileInvalid`, req.lang),
                    400,
                    `${ codePrefix }_FILE_INVALID`,
                    error
                ));
            }

            return next(error);
        });
    }
};

export {
    uploadSingleFile
}
