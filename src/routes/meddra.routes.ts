import { Router } from 'express';
import { meddraSearchLimiter, tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { searchMeddraTerms } from '../controllers/meddra.controller';
import { searchMeddraValidator } from '../validators';

const { USER } = ROLES;

const router = Router();

// This router mounts a single operation and it is not a CRUD: there is no table behind it and no
// row to create, update or retire. The codes 001 to 005B stay permanently unused in this
// abbreviation, which is the correct consequence of MEDDRA not being an entity (SPEC F55 §3.4)

// Search MedDRA Terms Against The Official API
// Code: ESAVI-MEDDRA-006
// The limiter goes first, before the token and the validators: one that runs after validation has
// already paid the cost it exists to avoid
router.get('/search', meddraSearchLimiter, tokenValidation, validateUserRole(USER), ...searchMeddraValidator, validateFields, searchMeddraTerms);

export default router;
