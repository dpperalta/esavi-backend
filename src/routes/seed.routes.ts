import { Router } from 'express';
import { executeAdminSeed } from '../controllers/seed.controller';
//import { tokenValidation } from '../middlewares/tokenValidation.middleware';
//import { validateUserRole } from '../middlewares/roleValidation.middleware';

const router = Router();

//router.post('/admin', [tokenValidation, validateUserRole('SUPERADMIN')], executeAdminSeed);
router.post('/admin', executeAdminSeed);

export default router;