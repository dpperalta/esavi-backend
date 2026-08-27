// Types of the mail transport (SPEC F43 §3.3). They live in `common` and not in `auth` because
// the transport belongs to no domain: the password reset email is the first message this
// repository sends, not the only one it will ever send.

/**
 * A composed message, ready to hand to the transport. `html` and `text` both travel in the same
 * message: a client that does not render HTML still gets the link.
 */
export interface MailMessage {
    to: string;
    subject: string;
    html: string;
    text: string;
}

/**
 * The transport configuration, already resolved. Each field comes from `systemConfig` when the
 * row exists and is not empty, and from the environment variable of the same name otherwise —
 * the precedence rule SPEC F43 §3.6 fixes for its eight codes.
 */
export interface MailConfig {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    from: string;
}
