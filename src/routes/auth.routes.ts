import { Router } from 'express';

import { login, logout, refresh }  from '../controllers/auth.controller';
import { loginValidator, refreshTokenValidator } from '../validators';
import { validateFields } from '../middlewares';

const router = Router();

// POST: /api/auth/login
router.post('/login', ...loginValidator, validateFields, login);

// POST: /api/auth/logout
// No tokenValidation either, and for the same reason: requiring a valid access token to close a
// session means whoever needs it most — the one holding an expired token — cannot, and their
// refresh token stays alive until it expires. SPEC F42 3.4
router.post('/logout', ...refreshTokenValidator, validateFields, logout);

// POST: /api/auth/refresh
// No tokenValidation on purpose: the access token is normally expired exactly when this endpoint
// is needed. The credential is the refresh token in the body, and the service checks it against
// `appSession`. SPEC F42 3.4
router.post('/refresh', ...refreshTokenValidator, validateFields, refresh);

export default router;