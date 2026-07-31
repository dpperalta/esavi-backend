import { Request, Response } from 'express';

const healthCheck = (req: Request, res: Response): Response => {
    console.log({req: req.query.lang});
    console.log(({required: req.lang}));
    return res.status(200).json({
        ok: true,
        message: 'ESAVI API is healthy and running'
    });
}

export {
    healthCheck
}