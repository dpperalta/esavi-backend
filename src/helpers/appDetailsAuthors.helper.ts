// Audit authors in responses — the pure half of SPEC F59.
//
// appDetails stores the userId of whoever ran each operation, and that is what stays stored.
// Responses replace it with the author's email, or with null. These functions walk the response
// and do the replacement; the query that maps userIds to emails lives in
// services/common/appDetailsAuthors.service.ts, because database access belongs to services.
//
// The audit array is recognised by its key, `appDetails`, never by the shape of its entries: any
// other JSONB whose objects happen to carry `createdAt`, `user`, `method` and `detail` is left
// alone.

import { Model } from 'sequelize';

const AUDIT_KEY = 'appDetails';

// "userId" is a uuid column: a literal such as 'undefined' inside the IN would make PostgreSQL
// reject the whole query with 22P02, so only real UUIDs are collected
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if( value === null || typeof value !== 'object' ) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

// To Plain Response
// Model instances, also nested inside arrays and composed objects, become plain objects: what
// res.json would produce, but early enough to rewrite them. Dates stay Date instances. The
// result is a copy: get({ plain: true }) hands back the instance's own dataValues, and rewriting
// the response must not rewrite the instance
const toPlainResponse = (data: unknown): unknown => {
    if( data instanceof Model ) {
        return toPlainResponse(data.get({ plain: true }));
    }
    if( Array.isArray(data) ) {
        return data.map(toPlainResponse);
    }
    if( isPlainObject(data) ) {
        const plain: Record<string, unknown> = {};
        for( const [ key, value ] of Object.entries(data) ) {
            plain[key] = toPlainResponse(value);
        }
        return plain;
    }
    return data;
}

// Visits every array held under an `appDetails` key, at any depth. It does not descend into the
// audit entries themselves
const visitAuditArrays = (value: unknown, visit: (holder: Record<string, unknown>, entries: unknown[]) => void): void => {
    if( Array.isArray(value) ) {
        for( const item of value ) {
            visitAuditArrays(item, visit);
        }
        return;
    }
    if( !isPlainObject(value) ) {
        return;
    }
    for( const [ key, child ] of Object.entries(value) ) {
        if( key === AUDIT_KEY && Array.isArray(child) ) {
            visit(value, child);
            continue;
        }
        visitAuditArrays(child, visit);
    }
}

// Collect App Details User Ids
// The distinct `user` values of every audit entry in a plain response that are UUIDs
const collectAppDetailsUserIds = (plain: unknown): string[] => {
    const userIds = new Set<string>();
    visitAuditArrays(plain, (_holder, entries) => {
        for( const entry of entries ) {
            if( isPlainObject(entry) && typeof entry.user === 'string' && UUID.test(entry.user) ) {
                userIds.add(entry.user);
            }
        }
    });
    return [ ...userIds ];
}

// Apply App Details Authors
// Rewrites every `appDetails[].user` of a plain response to authors.get(user), or null. The
// entries are copied, not mutated, so a caller that skipped toPlainResponse still leaves its
// source objects intact
const applyAppDetailsAuthors = (plain: unknown, authors: Map<string, string>): unknown => {
    visitAuditArrays(plain, (holder, entries) => {
        holder[AUDIT_KEY] = entries.map(entry => {
            if( !isPlainObject(entry) ) {
                return entry;
            }
            const author = typeof entry.user === 'string' ? authors.get(entry.user) : undefined;
            return { ...entry, user: author ?? null };
        });
    });
    return plain;
}

export {
    toPlainResponse,
    collectAppDetailsUserIds,
    applyAppDetailsAuthors
}
