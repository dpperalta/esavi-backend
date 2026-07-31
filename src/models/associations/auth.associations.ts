import { AppUser }  from '../appUser.model';
import { AppRole }  from '../appRole.model';
import { AppUserRole } from '../appUserRole.model';

export const initAuthAssociations = ():void => {
    // appUser <-> appUserRole
    AppUser.hasMany(AppUserRole, { foreignKey: 'userId', as: 'userRoles' });
    AppUserRole.belongsTo(AppUser, { foreignKey: 'userId', as: 'user' });
    // appRole <-> appUserRole
    AppRole.hasMany(AppUserRole, { foreignKey: 'roleId', as: 'roleUsers' });
    AppUserRole.belongsTo(AppRole, { foreignKey: 'roleId', as: 'role' });
    // Self-referential association for assignedByUserId
    AppUserRole.belongsTo(AppUser, { foreignKey: 'assignedByUserId', as: 'assignedUser' });
    AppUser.hasMany(AppUserRole, { foreignKey: 'assignedByUserId', as: 'assignedBy' });
    // User-Role Many-to-Many through AppUserRole
    AppUser.belongsToMany(AppRole, { through: AppUserRole, foreignKey: 'userId', otherKey: 'roleId', as: 'roles' });
    AppRole.belongsToMany(AppUser, { through: AppUserRole, foreignKey: 'roleId', otherKey: 'userId', as: 'users' });
};