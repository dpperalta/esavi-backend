import { Router } from 'express';

import { login, refresh }  from '../controllers/auth.controller';
import { loginValidator, refreshTokenValidator } from '../validators';
import { validateFields } from '../middlewares';

const router = Router();

// POST: /api/auth/login
router.post('/login', ...loginValidator, validateFields, login);

// POST: /api/auth/refresh
// No tokenValidation on purpose: the access token is normally expired exactly when this endpoint
// is needed. The credential is the refresh token in the body, and the service checks it against
// `appSession`. SPEC F42 3.4
router.post('/refresh', ...refreshTokenValidator, validateFields, refresh);

export default router;