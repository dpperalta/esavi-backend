import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createSystemConfig,
    getAllSystemConfigs,
    getSystemConfigs
} from '../controllers/systemConfig.controller';
import { createSystemConfigValidator, systemConfigListValidator } from '../validators';

// THE ORDER OF DECLARATION IN THIS FILE IS NOT COSMETIC. The four literal paths — '/admin',
// '/code/:code', '/sync' and '/activate/:id' — go BEFORE '/:id', or Express will capture 'admin' and
// 'sync' as an :id and the UUID validator will answer 400. '/:id/history' also goes before '/:id' for
// legibility, though there Express tells them apart by segment count.
//
// FOUR OF THE TEN ROUTES DEVIATE FROM THE CANONICAL ROLE MATRIX of CONVENTIONS §9, demanding
// SUPERADMIN where the norm puts ADMIN: the 001, the 004, the 005A and the 005B. A parameter of this
// table governs the behaviour of the whole application for all of its users, and isEncrypted declares
// that some of them may be a secret. The deviation is declared in SPEC F26 §2, §3.4 and §6, and it is
// deliberate — not an oversight of the matrix. The 002B stays on ADMIN and the three ordinary reads
// on USER: knowing which parameters exist is not the same as changing them.
//
// There is no 005C: systemConfig and systemConfigHistory are both in the preventPhysicalDelete loop
// (esaviapp.sql:1371), so by the availability rule of CONVENTIONS §6 physical deletion is not
// declared. The codes from 009 on stay free.
const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create System Config - For SuperAdmin
// Code: ESAVI-SYSCONF-001
router.post('/', tokenValidation, validateUserRole(SUPERADMIN), ...createSystemConfigValidator, validateFields, createSystemConfig);

// Get Active System Configs
// Code: ESAVI-SYSCONF-002A
router.get('/', tokenValidation, validateUserRole(USER), ...systemConfigListValidator, validateFields, getSystemConfigs);

// Get All System Configs - For Admin
// Code: ESAVI-SYSCONF-002B
// Literal path, declared before '/:id' so Express does not capture 'admin' as an :id
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...systemConfigListValidator, validateFields, getAllSystemConfigs);

export default router;
