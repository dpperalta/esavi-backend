import { body } from 'express-validator';

export const createAppRoleValidator = [
    body('name')
        .trim()
        .notEmpty().withMessage('Name is required'),
    
    body('code')
        .trim()
        .notEmpty().withMessage('Code is required'),
    
    body('description')
        .trim()
        .notEmpty().withMessage('Description is required'),
    
    body('isSystemRole')
        .isBoolean().withMessage('isSystemRole must be a boolean value')

];