import { Router } from 'express';

import { loginController }  from '../controllers/auth.controller';
import { loginValidator } from '../validators';
import { validateFields } from '../middlewares';

const router = Router();

// POST: /api/auth/login
router.post('/login', ...loginValidator, validateFields, loginController);

export default router;