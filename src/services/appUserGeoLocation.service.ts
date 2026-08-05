import { Op } from 'sequelize';
import { AppUser, AppUserGeoLocation, GeoLocation } from '../models';
import { AppError, getMessage } from '../helpers';
import { esaviDecrypt } from '../helpers/crypto.helper';
import { AppDetails, AuthUser, CreateAppUserGeoLocationInput } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The PII columns returned for the assigned user, and the geoLocation attributes.
// GeoLocation is listed attribute by attribute on purpose: the full attribute list
// drags the geometry column into every row of every listing
const USER_ATTRIBUTES = ['userId', 'username', 'firstName', 'lastName', 'email'];

const geoLocationInclude = {
    model: GeoLocation,
    as: 'geoLocation',
    attributes: ['geoLocationId', 'name', 'level', 'parentGeoLocationId']
};

// AppUser PII is stored encrypted, so a raw email is useless to any client.
// Null-safe because firstName and lastName are optional columns
const decryptField = (value?: string | null) => value ? esaviDecrypt(value) : value ?? null;

const toUserResponse = (user: AppUser) => ({
    userId: user.userId,
    username: decryptField(user.username),
    firstName: decryptField(user.firstName),
    lastName: decryptField(user.lastName),
    email: decryptField(user.email)
});

const toAssignmentResponse = (assignment: AppUserGeoLocation) => {
    const plain = assignment.toJSON() as Record<string, unknown>;
    if (plain.user) {
        plain.user = toUserResponse(plain.user as AppUser);
    }
    return plain;
}

// Only assignments in force right now: an open-ended validity, or one that has not expired yet.
// Built per call, so the cutoff is the request time and not the moment the module was loaded
const currentValidityFilter = () => ({
    [Op.or]: [
        { validTo: null },
        { validTo: { [Op.gt]: new Date() } }
    ]
});

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

// ESAVI-USERGEO-002A - Get App User Geo Locations By User Service
// `current` defaults to true at the route: whoever reads the operational state of a user
// should not be shown assignments that already expired
const getAppUserGeoLocationsByUserService = async (userId: string, lang: string, current: boolean, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    // The same user owns every row of this listing, so it is fetched and decrypted once
    // for the whole response rather than per row
    const user = await AppUser.findOne({
        where: { userId },
        attributes: USER_ATTRIBUTES
    });
    if (!user) {
        throw new AppError(getMessage('user.notFound', lang), 404, 'USERGEO_002A_USER_NOT_FOUND');
    }
    const assignments = await AppUserGeoLocation.findAndCountAll({
        where: {
            userId,
            isActive: true,
            ...( current ? currentValidityFilter() : {} )
        },
        include: [geoLocationInclude],
        order: [['validFrom', 'DESC']],
        limit,
        offset
    });
    return {
        count: assignments.count,
        user: toUserResponse(user),
        rows: assignments.rows.map(toAssignmentResponse)
    };
}

// ESAVI-USERGEO-002B - Get All App User Geo Locations By User Service - For Admin
// Same listing without the isActive filter, and with `current` defaulting to false at the route
const getAllAppUserGeoLocationsByUserService = async (userId: string, lang: string, current: boolean, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const user = await AppUser.findOne({
        where: { userId },
        attributes: USER_ATTRIBUTES
    });
    if (!user) {
        throw new AppError(getMessage('user.notFound', lang), 404, 'USERGEO_002B_USER_NOT_FOUND');
    }
    const assignments = await AppUserGeoLocation.findAndCountAll({
        where: {
            userId,
            ...( current ? currentValidityFilter() : {} )
        },
        include: [geoLocationInclude],
        order: [['validFrom', 'DESC']],
        limit,
        offset
    });
    return {
        count: assignments.count,
        user: toUserResponse(user),
        rows: assignments.rows.map(toAssignmentResponse)
    };
}

export {
    createAppUserGeoLocationService,
    getAppUserGeoLocationsByUserService,
    getAllAppUserGeoLocationsByUserService
};
