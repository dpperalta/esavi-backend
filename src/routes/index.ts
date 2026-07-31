import { Router } from 'express';
import healthRoutes from './health.routes';
import seedRoutes from './seed.route';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import geoLevelTypeRoutes from './geoLevelType.routes';
import geoLocationRoutes from './geoLocation.routes';
import catalogTypeRoutes from './catalogType.routes';
import catalogItemRoutes from './catalogItem.route';
import healthFacilityRoutes from './healthFacility.routes';

const router = Router();

router.use('/health', healthRoutes);
router.use('/seed', seedRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/geo-level-types', geoLevelTypeRoutes);
router.use('/geo-locations', geoLocationRoutes);
router.use('/catalog-types', catalogTypeRoutes);
router.use('/catalog-items', catalogItemRoutes);
router.use('/health-facilities', healthFacilityRoutes);

export default router;