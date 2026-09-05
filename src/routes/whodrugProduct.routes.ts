import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { getAllWhodrugProducts, syncWhodrugProducts } from '../controllers/whodrugProduct.controller';
import { syncWhodrugProductsValidator, whodrugProductListValidator } from '../validators';

const { ADMIN, SUPERADMIN } = ROLES;

const router = Router();

// The raw mirror of the WHODrug standard (SPEC F56). No 001, 004, 005A or 005B: nobody edits a
// mirror of an external standard by hand — the sync (007) is the only write door. All three routes
// of this entity are literal, so there is no risk of a future '/:id' capturing one of them; if a
// 003 is ever added, it goes declared after the three below

// List Whodrug Products For Inspection (raw mirror, admin only, no country/ATC policy applied)
// Code: ESAVI-WHODPROD-002B
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...whodrugProductListValidator, validateFields, getAllWhodrugProducts);

// Sync The WHODrug Standard From The UMC regional-drugs API
// Code: ESAVI-WHODPROD-007
router.post('/sync', tokenValidation, validateUserRole(SUPERADMIN), ...syncWhodrugProductsValidator, validateFields, syncWhodrugProducts);

export default router;
