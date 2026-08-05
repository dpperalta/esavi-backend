import { AppUser, AppUserGeoLocation, GeoLocation } from '../models';
import { AppError, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateAppUserGeoLocationInput } from '../types';

// ESAVI-USERGEO-001 - Create App User Geo Location Service
// One row per (userId, geoLocationId) pair, forever: the pair is never duplicated, it is reactivated.
// This is stricter than UQ_appUserGeoLocation_active_user_geoLocation, which only covers active rows
// with a null validTo, so the existence check must not filter by isActive, deletedAt or validTo.
const createAppUserGeoLocationService = async (data: CreateAppUserGeoLocationInput, authUser: AuthUser | undefined, lang: string) => {
    const { userId, geoLocationId } = data;
    // Validate that the referenced AppUser exists and is active
    const user = await AppUser.findOne({
        where: { userId, isActive: true },
        attributes: ['userId']
    });
    if (!user) {
        throw new AppError(getMessage('user.notFound', lang), 404, 'USERGEO_001_USER_NOT_FOUND');
    }
    // Validate that the referenced GeoLocation exists and is active
    const geoLocation = await GeoLocation.findOne({
        where: { geoLocationId, isActive: true },
        attributes: ['geoLocationId']
    });
    if (!geoLocation) {
        throw new AppError(getMessage('geoLocation.notFound', lang), 404, 'USERGEO_001_GEOLOC_NOT_FOUND');
    }
    // The CK_appUserGeoLocation_dates CHECK would raise a 500 here, so the range is validated first
    const validFrom = data.validFrom ? new Date(data.validFrom) : new Date();
    const validTo = data.validTo ? new Date(data.validTo) : null;
    if (validTo && validTo <= validFrom) {
        throw new AppError(getMessage('appUserGeoLocation.invalidDateRange', lang), 409, 'USERGEO_001_INVALID_DATE_RANGE');
    }
    const existingAssignment = await AppUserGeoLocation.findOne({
        where: { userId, geoLocationId }
    });
    // An active pair is a duplicate; without this check the partial unique index raises a 23505,
    // which reaches the client as a 500 instead of a 409
    if (existingAssignment && existingAssignment.isActive) {
        throw new AppError(getMessage('appUserGeoLocation.assignmentExists', lang), 409, 'USERGEO_001_ASSIGNMENT_EXISTS');
    }
    // assignedByUserId is audit data: it always comes from the token, never from the body
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-USERGEO-001',
        detail: existingAssignment ? 'Assignment reactivated by create' : 'Assignment created by service'
    };
    if (existingAssignment) {
        const currentAppDetails = Array.isArray(existingAssignment.appDetails) ? existingAssignment.appDetails : [];
        await existingAssignment.update({
            isActive: true,
            deletedAt: null,
            validTo,
            validFrom,
            assignedByUserId: authUser?.userId ?? null,
            updatedAt: new Date(),
            appDetails: [...currentAppDetails, newEntry]
        });
        return { assignment: existingAssignment, created: false };
    }
    const newAssignment = await AppUserGeoLocation.create({
        userId,
        geoLocationId,
        validFrom,
        validTo,
        assignedByUserId: authUser?.userId ?? null,
        isActive: data.isActive !== undefined ? data.isActive : true,
        appDetails: [newEntry]
    });
    return { assignment: newAssignment, created: true };
}

export {
    createAppUserGeoLocationService
};
