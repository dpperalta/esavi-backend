import fs from 'fs';
import path from 'path';
import nodemailer, { Transporter } from 'nodemailer';
import { MailConfig } from '../types';

/**
 * Mail transport of SPEC F43 §3.6.
 *
 * Two things live here and nothing else: building the `nodemailer` transport from an already
 * resolved `MailConfig`, and rendering a template file into the two bodies a message carries.
 * Resolving the configuration is `appConfig.helper.ts`, sending is
 * `src/services/common/mail.service.ts`, and composing the message is the caller's job — here
 * ESAVI-AUTH-006.
 *
 * UNDER NODE_ENV=test THE TRANSPORT IS `jsonTransport`, which serialises the message and opens no
 * connection. That is what lets `tests/contract/auth.test.ts` assert on the content of the email
 * — the link, the markers, the language — without SMTP and without network. The declared price is
 * in §7: the suite never exercises the real SMTP path, so a wrong host, port, TLS mode or
 * credential is not caught by any test.
 */

// The three markers of §3.6. A template that leaves one unsubstituted is a bug that shows up in
// the user's inbox, which is why the render throws instead of shipping a literal `{{...}}`.
const MARKER_PATTERN = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;

// Fallback language of the templates, the same one the i18n helper falls back to. A deployment
// that adds a language to SUPPORTED_LANGUAGES without adding its templates sends Spanish rather
// than nothing.
const FALLBACK_TEMPLATE_LANGUAGE = 'es';

/**
 * Where the six template files live.
 *
 * Unlike the message catalogues, templates are not imported: they are read from disk, so the
 * directory has to be found at runtime. `__dirname` covers a build that ships them next to the
 * compiled code, and the working directory covers `ts-node` and the test runner, which execute
 * straight out of `src/`. THE FIRST CANDIDATE THAT EXISTS WINS.
 */
const TEMPLATE_DIRECTORY_CANDIDATES = [
    path.join( __dirname, '..', 'data', 'emails' ),
    path.join( process.cwd(), 'src', 'data', 'emails' ),
    path.join( process.cwd(), 'dist', 'data', 'emails' )
];

export interface RenderedEmail {
    html: string;
    text: string;
}

/**
 * Builds the transport.
 *
 * Under `NODE_ENV=test` the configuration is ignored on purpose: a suite that opened a real
 * connection would depend on a mail server being reachable, and the whole point of the JSON
 * transport is that the assertions are about the message, not about the delivery.
 */
export const buildMailTransport = ( config: MailConfig ): Transporter => {
    if( process.env.NODE_ENV === 'test' ) {
        return nodemailer.createTransport( { jsonTransport: true } );
    }

    return nodemailer.createTransport( {
        host: config.host,
        port: config.port,
        // Implicit TLS on 465; STARTTLS negotiation on 587, which is what `false` means here
        secure: config.secure,
        auth: {
            user: config.user,
            pass: config.password
        }
    } );
}

// Reads one template file, or undefined when that language has none
const readTemplate = ( name: string, lang: string, extension: 'html' | 'txt' ): string | undefined => {
    const fileName = `${ name }.${ lang }.${ extension }`;

    for( const directory of TEMPLATE_DIRECTORY_CANDIDATES ) {
        const candidate = path.join( directory, fileName );
        if( fs.existsSync( candidate ) ) {
            return fs.readFileSync( candidate, 'utf8' );
        }
    }
    return undefined;
}

// Substitutes every marker and refuses to return a body with one left over
const substitute = ( template: string, values: Record<string, string> ): string => {
    const rendered = template.replace( MARKER_PATTERN, ( _match, marker: string ) => {
        const value = values[ marker ];
        if( value === undefined ) {
            throw new Error( `Missing value for template marker {{${ marker }}}` );
        }
        return value;
    } );

    return rendered;
}

/**
 * Renders the two bodies of a message from the template pair of a language.
 *
 * BOTH VARIANTS TRAVEL IN THE SAME MESSAGE, as §3.6 requires: a client that does not render HTML
 * still receives the link. The language is `req.lang`, resolved by `languageMiddleware` on the
 * request of ESAVI-AUTH-006 — `appUser` has no preferred-language column, and the declared
 * consequence is that whoever asks for the reset from an English browser gets an English email
 * even if they use the application in Spanish.
 */
export const renderEmailTemplate = ( name: string, lang: string, values: Record<string, string> ): RenderedEmail => {
    const html = readTemplate( name, lang, 'html' ) ?? readTemplate( name, FALLBACK_TEMPLATE_LANGUAGE, 'html' );
    const text = readTemplate( name, lang, 'txt' ) ?? readTemplate( name, FALLBACK_TEMPLATE_LANGUAGE, 'txt' );

    if( !html || !text ) {
        throw new Error( `Missing email template ${ name } for language ${ lang }` );
    }

    return {
        html: substitute( html, values ),
        text: substitute( text, values )
    };
}
