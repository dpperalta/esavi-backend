import { Request, Response } from 'express';

const healthCheck = (req: Request, res: Response): Response => {
    return res.status(200).json({
        ok: true,
        message: 'ESAVI API is healthy and running'
    });
}

export {
    healthCheck
}