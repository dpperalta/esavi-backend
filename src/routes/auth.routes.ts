import { Router } from 'express';

import { forgotPassword, login, logout, logoutAll, refresh }  from '../controllers/auth.controller';
import { forgotPasswordValidator, loginValidator, refreshTokenValidator } from '../validators';
import { validateFields, tokenValidation, validateUserRole, passwordResetLimiter } from '../middlewares';
import { ROLES } from '../constants/roles.constants';

const router = Router();

// Login
// Code: ESAVI-AUTH-001
// POST: /api/auth/login
router.post('/login', ...loginValidator, validateFields, login);

// Logout
// Code: ESAVI-AUTH-003
// POST: /api/auth/logout
// No tokenValidation either, and for the same reason: requiring a valid access token to close a
// session means whoever needs it most — the one holding an expired token — cannot, and their
// refresh token stays alive until it expires. SPEC F42 3.4
router.post('/logout', ...refreshTokenValidator, validateFields, logout);

// Logout All Sessions
// Code: ESAVI-AUTH-004
// POST: /api/auth/logout-all
// This one does carry tokenValidation: revoking every session of an account demands a proven
// identity, and the userId comes from req.user. Taking it from the body would make the endpoint a
// denial of service against any user. SPEC F42 3.4
router.post('/logout-all', tokenValidation, validateUserRole(ROLES.USER), logoutAll);

// Refresh Token
// Code: ESAVI-AUTH-002
// POST: /api/auth/refresh
// No tokenValidation on purpose: the access token is normally expired exactly when this endpoint
// is needed. The credential is the refresh token in the body, and the service checks it against
// `appSession`. SPEC F42 3.4
router.post('/refresh', ...refreshTokenValidator, validateFields, refresh);


// Request Password Reset
// Code: ESAVI-AUTH-006
// POST: /api/auth/forgot-password
// Public, and here that means without a previous credential: whoever calls it cannot authenticate,
// which is the problem it solves. The limiter goes FIRST on purpose — five requests per IP every
// 15 minutes, against the 100 of the global one — because a limiter that runs after the validators
// has already paid the cost it exists to avoid. SPEC F43 3.4
router.post('/forgot-password', passwordResetLimiter, ...forgotPasswordValidator, validateFields, forgotPassword);

export default router;