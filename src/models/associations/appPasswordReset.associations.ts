import { AppPasswordReset } from '../appPasswordReset.model';
import { AppUser } from '../appUser.model';

export const initAppPasswordResetAssociations = (): void => {
    // AppPasswordReset -> AppUser (request owner). FK_appPasswordReset_user, esaviapp.sql:374.
    AppUser.hasMany(AppPasswordReset, { foreignKey: 'userId', as: 'passwordResets' });
    AppPasswordReset.belongsTo(AppUser, { foreignKey: 'userId', as: 'user' });
}
