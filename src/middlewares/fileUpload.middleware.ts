import { Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';

import { AppError } from '../helpers/appError.helper';
import { getMessage } from '../helpers/i18n.helper';
import { esaviLog } from '../helpers/esaviLogs.helper';

// A MedDRA llt.asc of a recent release is around 10 MB. 20 MB leaves room to spare and stops the
// upload before the buffer grows, which is the whole point of holding the file in memory.
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
 * Receives a single file under `fieldName` and leaves it in `req.file`.
 * Multer errors are translated here, never in the service: the limit is enforced by multer
 * before the handler runs, so the service never sees an oversized buffer.
 */
const uploadSingleFile = ( fieldName: string ) => {
    const handler = upload.single(fieldName);

    return ( req: Request, res: Response, next: NextFunction ): void => {
        handler(req, res, ( error: unknown ) => {
            if( !error ) {
                return next();
            }

            if( error instanceof MulterError ) {
                if( error.code === 'LIMIT_FILE_SIZE' ) {
                    esaviLog('ESAVI-DIAGTERM-007 - Uploaded file exceeds the allowed size', 'warn');
                    return next(new AppError(
                        getMessage('diagnosticTerm.fileTooLarge', req.lang),
                        413,
                        'DIAGTERM_007_FILE_TOO_LARGE',
                        error
                    ));
                }

                esaviLog(`ESAVI-DIAGTERM-007 - Upload rejected by multer: ${ error.code }`, 'error');
                return next(new AppError(
                    getMessage('diagnosticTerm.fileInvalid', req.lang),
                    400,
                    'DIAGTERM_007_FILE_INVALID',
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
