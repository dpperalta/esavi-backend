import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { getMessage } from '../helpers/i18n.helper';
import { AppRole } from '../models/appRole.model';
import { esaviLog } from '../helpers/esaviLogs.helper';
import { AppUser, AppUserRole } from '../models';
import { esaviCrypt } from '../helpers/crypto.helper';

// Execute admin seed to create a superadmin role and user
// Code: ESAVI-SEED-001
const executeAdminSeed = async (req: Request, res: Response): Promise<Response> => {
    const ip = req.ip;
    const { enable } = req.query;
    try {
        if( enable === process.env.SEED_ACTION ){
            const roleName = process.env.ESAVI_SUPERADMIN || 'SUPERADMIN';
            const superAdminEmail = esaviCrypt((process.env.ESAVI_SUPERADMIN_X)!.toString());
            const superAdminPassword = process.env.ESAVI_SUPERADMIN_Y;
            if( !superAdminEmail || !superAdminPassword ) {
                return res.status(500).json({
                    ok: false,
                    message: getMessage('seed.requiredParameters', req.lang),
                    data: {}
                });
            }
            // Creating or getting the superadmin role
            const [role] = await AppRole.findOrCreate({
                where: { name: roleName },
                defaults: { 
                    code: 'SUPERADMIN',
                    name: roleName,
                    description: 'Superadmin role with all permissions',
                    isSystemRole: true,
                    level: 100,
                    appDetails: [{
                        'createdAt': new Date(),
                        'user': 'seedScript',
                        'method': 'ESAVI-SEED-001',
                        'ipAddress': ip,
                        'detail': 'Role created by seed script'
                    }]
                }
            });
            const roleId = role.getDataValue('roleId');
            // Creating or getting the superadmin user
            const salt = bcrypt.genSaltSync();
            const maskPass = bcrypt.hashSync(superAdminPassword, salt);
            const [user] = await AppUser.findOrCreate({
                where: { email: superAdminEmail },
                defaults: {
                    username: esaviCrypt('Super Admin'),
                    email: superAdminEmail,
                    passwordHash: maskPass,
                    displayName: esaviCrypt('Super Admin'),
                    requiresPasswordChange: false,
                    isActive: true,
                    appDetails: [{
                        'createdAt': new Date(),
                        'user': 'seedScript',
                        'method': 'ESAVI-SEED-001',
                        'ipAddress': ip,
                        'detail': 'User created by seed script'
                    }]
                }
            });
            const userId = user.getDataValue('userId');
            // Assigning the superadmin role to the user
            await AppUserRole.findOrCreate({
                where: { userId, roleId },
                defaults: {
                    userId,
                    roleId,
                    assignedByUserId: userId,
                    validFrom: new Date(),
                    appDetails: [{
                        'createdAt': new Date(),
                        'user': 'seedScript: ' + userId,
                        'method': 'ESAVI-SEED-001',
                        'ipAddress': ip,
                        'detail': 'Role assigned by seed script'
                    }]
                }
            });
            // Creating the default role for users
            await AppRole.findOrCreate({
                where: { name: process.env.ESAVI_USER || 'USER' },
                defaults: { 
                    code: 'USER',
                    name: process.env.ESAVI_USER || 'USER',
                    description: 'Default role for regular users',
                    isSystemRole: false,
                    level: 25,
                    appDetails: [{
                        'createdAt': new Date(),
                        'user': 'seedScript',
                        'method': 'ESAVI-SEED-001',
                        'ipAddress': ip,
                        'detail': 'Role created by seed script'
                    }]
                }
            });
        }
    } catch (error) {
        esaviLog(`[SEED ERROR]: ${ error instanceof Error ? error.message : 'Unknown error' }`, 'error',);
        return res.status(500).json({
            ok: false,
            message: getMessage('seed.seedFailed', req.lang),
            errors: error instanceof Error ? error.message : 'Unknown error',
            data: {}
        });
    }
    return res.status(200).json({
        ok: true,
        message: getMessage('seed.seedCompleted', req.lang),
        data: {
            email: process.env.ESAVI_SUPERADMIN_X,
            role: process.env.ESAVI_SUPERADMIN || 'SUPERADMIN'
        }
    });
}

export {
    executeAdminSeed
}