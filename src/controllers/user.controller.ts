import { NextFunction, Request, Response } from 'express';
import {
    createUserService,
    getUsersService,
    getAllUsersService,
    getUserByIdService,
    getOwnProfileService,
    updateUserService
} from '../services/user.service';
import { esaviLog, getMessage, AppError, canViewInactive } from '../helpers';
import { AuthUser } from '../types';

// Create User Controller
// Code: ESAVI-USER-001
const createUser = async ( req: Request, res: Response, next: NextFunction ): Promise<Response | void> => {
    try {
        const data = await createUserService({ data: req.body, authUser: req.user, lang: req.lang });
        return res.status(201).json({
            ok: true,
            message: getMessage('user.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-USER-001: Error creating user: ' + error,  'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('user.createdFailed', req.lang), 500, 'USER_001_CREATION_FAILED', error));
    }
}

// Get Active Users Controller
// Code: ESAVI-USER-002A
const getUsers = async ( req: Request, res: Response, next: NextFunction ): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getUsersService(limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('user.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-USER-002A: Error getting users: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('user.getFailedPlural', req.lang), 500, 'USER_002A_FETCH_FAILED', error));
    }
}

// Get All Users Controller - For Admin
// Code: ESAVI-USER-002B
const getAllUsers = async ( req: Request, res: Response, next: NextFunction ): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllUsersService(limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('user.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-USER-002B: Error getting all users: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('user.getFailedPlural', req.lang), 500, 'USER_002B_FETCH_FAILED', error));
    }
}

// Get User By ID Controller
// Code: ESAVI-USER-003
const getUserById = async ( req: Request, res: Response, next: NextFunction ): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getUserByIdService(id, req.lang, canViewInactive(req.user as AuthUser));
        return res.status(200).json({
            ok: true,
            message: getMessage('user.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-USER-003: Error getting user by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('user.getFailed', req.lang), 500, 'USER_003_FETCH_FAILED', error));
    }
}

// Get Own Profile Controller
// Code: ESAVI-USER-007
const getOwnProfile = async ( req: Request, res: Response, next: NextFunction ): Promise<Response | void> => {
    try {
        const data = await getOwnProfileService(req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('user.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-USER-007: Error getting own profile: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('user.getFailed', req.lang), 500, 'USER_007_FETCH_FAILED', error));
    }
}

// Update User Controller
// Code: ESAVI-USER-004
const updateUser = async ( req: Request, res: Response, next: NextFunction ): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await updateUserService(id, req.body, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('user.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-USER-004: Error updating user: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('user.updatedFailed', req.lang), 500, 'USER_004_UPDATE_FAILED', error));
    }
}

export {
    createUser,
    getUsers,
    getAllUsers,
    getUserById,
    getOwnProfile,
    updateUser
}