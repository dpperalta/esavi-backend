import { Router } from 'express';

import { login }  from '../controllers/auth.controller';
import { loginValidator } from '../validators';
import { validateFields } from '../middlewares';

const router = Router();

// POST: /api/auth/login
router.post('/login', ...loginValidator, validateFields, login);

export default router;