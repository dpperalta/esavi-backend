import { AppError } from '../../helpers/appError.helper';
import { buildMailTransport } from '../../helpers/mailer.helper';
import {
    getAppConfigBoolean,
    getAppConfigNumber,
    getAppConfigString
} from '../../helpers/appConfig.helper';
import { MailConfig, MailMessage } from '../../types';

/**
 * Mail sending of SPEC F43 §3.6.
 *
 * The service knows nothing about `Request`, like every other service: it receives a `MailMessage`
 * already composed — subject resolved with `getMessage`, bodies rendered from the templates — and
 * its only job is to resolve the transport configuration and hand the message over.
 *
 * THE CONFIGURATION IS RESOLVED ON EVERY SEND, without a cache. That is the decision of §2: a
 * password reset is not a hot path — six reads per send — and caching would force an invalidation
 * from ESAVI-SYSCONF-004, a mechanism this spec must not invent. It is also what makes criterion
 * 21 true: a configuration change takes effect on the next send, with no restart.
 */

// The six MAIL codes, resolved by `systemConfig` first and the environment second
const MAIL_SCOPE = 'MAIL';

/**
 * Reads the six rows of scope MAIL and returns the transport configuration.
 *
 * An unconfigured deployment throws here, from `appConfig.helper.ts`, and ESAVI-AUTH-006 turns
 * that into an `error` log line and a 200 — never a 500, which would be the enumeration oracle
 * §3.5 closes everywhere else.
 */
const resolveMailConfig = async ( lang: string ): Promise<MailConfig> => {
    const [ host, port, secure, user, password, from ] = await Promise.all( [
        getAppConfigString( 'ESAVI_MAIL_SMTP_HOST', MAIL_SCOPE, lang ),
        getAppConfigNumber( 'ESAVI_MAIL_SMTP_PORT', MAIL_SCOPE, lang ),
        getAppConfigBoolean( 'ESAVI_MAIL_SMTP_SECURE', MAIL_SCOPE, lang ),
        getAppConfigString( 'ESAVI_MAIL_SMTP_USER', MAIL_SCOPE, lang ),
        getAppConfigString( 'ESAVI_MAIL_SMTP_PASSWORD', MAIL_SCOPE, lang ),
        getAppConfigString( 'ESAVI_MAIL_FROM', MAIL_SCOPE, lang )
    ] );

    return { host, port, secure, user, password, from };
}

/**
 * Sends one message and returns what the transport reported.
 *
 * Under `NODE_ENV=test` the return value is the message serialised by `jsonTransport`, which is
 * how the contract suite reads the link without SMTP and without network.
 */
const sendMailService = async ( message: MailMessage, lang: string ): Promise<unknown> => {
    const config = await resolveMailConfig( lang );
    const transport = buildMailTransport( config );

    try {
        return await transport.sendMail( {
            from: config.from,
            to: message.to,
            subject: message.subject,
            // Both variants in the same message: a client that does not render HTML still gets
            // the link
            html: message.html,
            text: message.text
        } );
    } catch ( error ) {
        // The caller decides what a failed delivery means. For ESAVI-AUTH-006 it means an `error`
        // log line and a 200, because a 500 could only ever happen on the path where the account
        // does exist
        throw new AppError( 'Mail delivery failed', 500, 'MAIL_SEND_FAILED', error );
    }
}

export {
    resolveMailConfig,
    sendMailService
}
