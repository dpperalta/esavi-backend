import request from 'supertest';
import type { Model, ModelStatic } from 'sequelize';
import { app } from '../../src/app';
import { authHeader } from './auth';
import type { TestRole } from './auth';

/**
 * SPEC F12 — the differential update, checked the same way in the twelve contract suites.
 *
 * The record is read with a GET and sent back whole with a PUT. That is what a form does when
 * somebody opens a screen and saves without typing: nothing changed, so nothing must be written
 * — no UPDATE, no `appDetails` entry, no `sysDetails.version` bump and no `updatedAt` move.
 *
 * Stronger than the empty body the old cases used: `{}` cannot tell "I do not compare values"
 * from "I do not write", and the six deviated services would have passed it by adding a
 * shortcut. Resending the stored values is the case only a real comparison survives.
 *
 * `sysDetails` never leaves through the API — it is trigger metadata — so the version is read
 * from the row itself, which is also the only place the trigger writes.
 */
export const expectPutOfGetResponseWritesNothing = async ( options: {
    path: string,
    id: string,
    model: ModelStatic<Model>,
    role?: TestRole,
    // Keys the update validator rejects with a 400 — a real form does not send them back either
    strip?: string[]
} ) => {
    const { path, id, model, role = 'ADMIN', strip = [] } = options;

    const before = await request(app).get(`${ path }/${ id }`).set(authHeader(role));
    expect(before.status).toBe(200);

    const rowBefore = await model.findByPk(id);
    const versionBefore = ( rowBefore!.getDataValue('sysDetails') as { version?: number } | null )?.version;
    const updatedAtBefore = rowBefore!.getDataValue('updatedAt');

    const body = { ...before.body.data };
    for( const key of strip ) {
        delete body[key];
    }

    const response = await request(app).put(`${ path }/${ id }`).set(authHeader(role)).send(body);

    expect(response.status).toBe(200);
    expect(response.body.data.appDetails).toHaveLength(before.body.data.appDetails.length);

    const rowAfter = await model.findByPk(id);
    expect(( rowAfter!.getDataValue('sysDetails') as { version?: number } | null )?.version).toBe(versionBefore);
    expect(rowAfter!.getDataValue('updatedAt')).toEqual(updatedAtBefore);
}
