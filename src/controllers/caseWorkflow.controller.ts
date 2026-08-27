import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser, CaseWorkflowListFilters, CaseWorkflowStage } from '../types';
import {
    completeCaseWorkflowStageService,
    getAllCaseWorkflowsService,
    getCaseWorkflowByCaseIdService,
    getCaseWorkflowByIdService,
    getCaseWorkflowsService
} from '../services/caseWorkflow.service';

// The four query filters of 002A and 002B. Only what actually arrives travels to the service, so
// an absent filter never turns into an `undefined` in the where clause
const listFilters = (req: Request): CaseWorkflowListFilters => ({
    caseId: req.query.caseId as string | undefined,
    statusCode: req.query.statusCode as string | undefined,
    openedFrom: req.query.openedFrom as string | undefined,
    openedTo: req.query.openedTo as string | undefined
});

// Get Case Workflows Controller
// Code: ESAVI-CASEFLOW-002A
const getCaseWorkflows = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getCaseWorkflowsService(listFilters(req), limit, offset, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('caseWorkflow.listSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CASEFLOW-002A: Error fetching Case Workflows: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('caseWorkflow.listFailed', req.lang), 500, 'CASEFLOW_002A_FETCH_FAILED', error));
    }
}

// Get All Case Workflows Controller - For Admin
// Code: ESAVI-CASEFLOW-002B
// The admin variant of the dual listing. It is a controller of its own and not a branch of the
// 002A, so each of the two operation codes lives in exactly one place
const getAllCaseWorkflows = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllCaseWorkflowsService(listFilters(req), limit, offset, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('caseWorkflow.listSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CASEFLOW-002B: Error fetching all Case Workflows: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('caseWorkflow.listFailed', req.lang), 500, 'CASEFLOW_002B_FETCH_FAILED', error));
    }
}

// Get Case Workflow By ID Controller
// Code: ESAVI-CASEFLOW-003
const getCaseWorkflowById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getCaseWorkflowByIdService(
            id.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('caseWorkflow.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CASEFLOW-003: Error fetching Case Workflow: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('caseWorkflow.getFailed', req.lang), 500, 'CASEFLOW_003_FETCH_FAILED', error));
    }
}

// Get Case Workflow By Case ID Controller
// Code: ESAVI-CASEFLOW-006
// The real query of the domain: the client holds the caseId, not the caseWorkflowId, and has
// never seen the latter. It returns the record itself and not { count, rows } — the relation is
// one to one, and wrapping a single record in a collection would force unwrapping a list of one
const getCaseWorkflowByCaseId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { caseId } = req.params;
    try {
        const data = await getCaseWorkflowByCaseIdService(
            caseId.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('caseWorkflow.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CASEFLOW-006: Error fetching Case Workflow by case: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('caseWorkflow.getFailed', req.lang), 500, 'CASEFLOW_006_FETCH_FAILED', error));
    }
}

// Complete Case Workflow Stage Controller
// Code: ESAVI-CASEFLOW-007
// Answers the full updated record in `data`, like the other four transitions. That does not
// contradict CONVENTIONS.md §10: the rule that forbids `data` covers the operations that RETIRE
// the row from view — 005A, 005B and 005C — while this one moves it to a state the client needs
// to paint immediately, and a follow-up 006 would be one call per transition too many
const completeCaseWorkflowStage = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { caseId } = req.params;
    const { stage } = req.body;
    try {
        const data = await completeCaseWorkflowStageService(
            caseId.toString().trim(),
            stage as CaseWorkflowStage,
            req.user as AuthUser,
            req.lang
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('caseWorkflow.stageCompletedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CASEFLOW-007: Error completing Case Workflow stage: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('caseWorkflow.stageCompletedFailed', req.lang), 500, 'CASEFLOW_007_COMPLETE_FAILED', error));
    }
}

export {
    getCaseWorkflows,
    getAllCaseWorkflows,
    getCaseWorkflowById,
    getCaseWorkflowByCaseId,
    completeCaseWorkflowStage
}
