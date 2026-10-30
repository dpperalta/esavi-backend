// One-off data migration for SPEC F64 §3.3: grants EVALUATOR to every current holder of USER, then
// lowers the USER row of appRole to level 20. Both parts run in one transaction, in that order.
//
// Run with: NODE_ENV=development npx ts-node scripts/grant-evaluator-to-users.ts
import { Op } from 'sequelize';
import { initModels, AppRole, AppUserRole } from '../src/models';
import { connectDatabase, sequelize } from '../src/database/connection';
import { ROLES, ROLE_LEVELS } from '../src/constants/roles.constants';
import { AppDetails } from '../src/types';

const MIGRATION_METHOD = 'SPEC-F64-MIGRATION';
const MIGRATION_USER = 'migrationScript';

const activeAssignment = {
    isActive: true,
    deletedAt: { [Op.is]: null },
    validTo: { [Op.is]: null }
};

const grantEvaluatorToUsers = async (): Promise<void> => {
    initModels();
    await connectDatabase();

    const result = await sequelize.transaction(async (transaction) => {
        const userRole = await AppRole.findOne({ where: { code: ROLES.USER }, transaction });
        const evaluatorRole = await AppRole.findOne({ where: { code: ROLES.EVALUATOR }, transaction });
        if (!userRole || !evaluatorRole) {
            throw new Error(
                `Aborting: the ${ !userRole ? ROLES.USER : ROLES.EVALUATOR } role does not exist. ` +
                'Run ESAVI-SEED-001 first; this script does not create roles.'
            );
        }
        const userRoleId = userRole.getDataValue('roleId');
        const evaluatorRoleId = evaluatorRole.getDataValue('roleId');

        const userAssignments = await AppUserRole.findAll({
            where: { roleId: userRoleId, ...activeAssignment },
            attributes: ['userId'],
            transaction
        });
        const userIds = [...new Set(userAssignments.map(row => row.getDataValue('userId') as string))];

        const alreadyEvaluators = await AppUserRole.findAll({
            where: { roleId: evaluatorRoleId, userId: { [Op.in]: userIds }, ...activeAssignment },
            attributes: ['userId'],
            transaction
        });
        const skippedIds = new Set(alreadyEvaluators.map(row => row.getDataValue('userId') as string));

        let created = 0;
        for (const userId of userIds) {
            if (skippedIds.has(userId)) continue;
            await AppUserRole.create({
                userId,
                roleId: evaluatorRoleId,
                validFrom: new Date(),
                assignedByUserId: null,
                isActive: true,
                appDetails: [{
                    createdAt: new Date(),
                    user: MIGRATION_USER,
                    method: MIGRATION_METHOD,
                    detail: 'EVALUATOR granted to preserve pre-F64 USER capabilities'
                }]
            } as never, { transaction });
            created += 1;
        }

        const targetLevel = ROLE_LEVELS[ROLES.USER];
        const oldLevel = userRole.getDataValue('level');
        let userRowUpdated = false;
        if (oldLevel !== targetLevel || userRole.getDataValue('isSystemRole') !== true) {
            const storedAppDetails = userRole.getDataValue('appDetails');
            const currentAppDetails = Array.isArray(storedAppDetails) ? storedAppDetails as AppDetails[] : [];
            await userRole.update({
                level: targetLevel,
                isSystemRole: true,
                updatedAt: new Date(),
                appDetails: [...currentAppDetails, {
                    createdAt: new Date(),
                    user: MIGRATION_USER,
                    method: MIGRATION_METHOD,
                    detail: `USER lowered from ${ oldLevel } to ${ targetLevel } (read-only role)`
                }]
            } as never, { transaction });
            userRowUpdated = true;
        }

        return { created, skipped: skippedIds.size, oldLevel, targetLevel, userRowUpdated };
    });

    console.log(`EVALUATOR assignments — created: ${ result.created }, skipped: ${ result.skipped }`);
    console.log(result.userRowUpdated
        ? `USER level: ${ result.oldLevel } → ${ result.targetLevel }`
        : `USER level: already ${ result.targetLevel } and system role, unchanged`);
    process.exit(0);
};

grantEvaluatorToUsers().catch((error) => {
    console.error(error);
    process.exit(1);
});
