import { AppSession } from '../appSession.model';
import { AppUser } from '../appUser.model';

export const initAppSessionAssociations = (): void => {
    // AppSession -> AppUser (session owner). FK_appSession_user, esaviapp.sql:353.
    AppUser.hasMany(AppSession, { foreignKey: 'userId', as: 'sessions' });
    AppSession.belongsTo(AppUser, { foreignKey: 'userId', as: 'user' });
}
