import { Request, Response, NextFunction } from 'express';

export const languageMiddleware = (req: Request, res: Response, next: NextFunction): void => {

    const defaultLanguage = process.env.DEFAULT_LANGUAGE || 'en';
    const supportedLanguages = (process.env.SUPPORTED_LANGUAGES || 'en').split(',').map(lang => lang.trim());

    const langFromHeader = req.header('Accept-Language');
    const langFromQuery = req.query.lang?.toString() as string | undefined;

    let selectedLanguage = langFromQuery || langFromHeader || defaultLanguage;

    req.lang = supportedLanguages.includes(selectedLanguage) ? selectedLanguage : defaultLanguage;

    next();
}