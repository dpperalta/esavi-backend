import { Request, Response, NextFunction } from 'express';
import { getDefaultLanguage } from '../helpers';

export const languageMiddleware = (req: Request, res: Response, next: NextFunction): void => {

    // Same resolution the i18n helper uses, so the middleware and getMessage cannot disagree on the default.
    const defaultLanguage = getDefaultLanguage();
    const supportedLanguages = (process.env.SUPPORTED_LANGUAGES || defaultLanguage).split(',').map(lang => lang.trim());

    const langFromHeader = req.header('Accept-Language');
    const langFromQuery = req.query.lang?.toString() as string | undefined;

    let selectedLanguage = langFromQuery || langFromHeader || defaultLanguage;

    req.lang = supportedLanguages.includes(selectedLanguage) ? selectedLanguage : defaultLanguage;

    next();
}