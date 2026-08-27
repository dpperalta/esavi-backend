// Password reset parameters for SPEC F43.
//
// The lifetime of a link does NOT live here: it is `ESAVI_PASSWORD_RESET_EXPIRES_MINUTES` of scope
// AUTH, read from `systemConfig` on every request through `appConfig.helper.ts`, because §3.6
// leaves it editable — the reasonable window depends on the deployment, and whoever can edit it is
// already SUPERADMIN. What lives here is the name of that parameter and the closed list of reasons.

export const PASSWORD_RESET_EXPIRES_MINUTES_CODE = 'ESAVI_PASSWORD_RESET_EXPIRES_MINUTES';
export const PASSWORD_RESET_URL_CODE = 'ESAVI_PASSWORD_RESET_URL';
export const PASSWORD_RESET_SCOPE = 'AUTH';

// The three reasons `appPasswordReset.invalidatedReason` may hold. The column is free `text` in
// the DDL, so this list is the only thing keeping the values from drifting; §3.5 of SPEC F43
// assigns one to each writer:
//
//   SUPERSEDED        a later request displaced this one, or the password was just reset
//   REUSE_DETECTED    an already consumed token was presented again
//   PASSWORD_CHANGED  the owner changed the password deliberately, through ESAVI-USER-006
export const PASSWORD_RESET_INVALIDATION_REASONS = [
    'SUPERSEDED',
    'REUSE_DETECTED',
    'PASSWORD_CHANGED'
] as const;

export type PasswordResetInvalidationReason = ( typeof PASSWORD_RESET_INVALIDATION_REASONS )[number];
