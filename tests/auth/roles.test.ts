import request from 'supertest';
import { app } from '../../src/app';
import { ROLE_LEVELS, ROLES } from '../../src/constants/roles.constants';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import type { TestRole } from '../setup/auth';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface RouteRule {
    method: Method;
    path: string;
    minRole: TestRole;
    code: string;
}

const UUID = '00000000-0000-4000-8000-000000000000';

/**
 * The canonical matrix of section 9 of CONVENTIONS.md, route by route.
 * `validateUserRole(X)` means "level >= level(X)", so every rule is checked from
 * both sides: the role immediately below must get 403, and the exact role must
 * not. Adding a route without adding it here leaves it unguarded by the suite.
 */
const ROUTE_RULES: RouteRule[] = [
    // auth (SPEC F42) — only ESAVI-AUTH-004 has a row here. The other three carry no minimum role:
    // ESAVI-AUTH-001 never had one, and ESAVI-AUTH-002 and -003 deliberately go without
    // tokenValidation, because the access token is normally expired exactly when a refresh or a
    // logout is needed — their credential is the refresh token in the body, checked against
    // appSession, not a role. The precedent for an operation without a row is ESAVI-DIAGTERM-006.
    // ESAVI-SESSION-001, -006 and -007 have no row either: they have no HTTP route at all
    { method: 'post',   path: '/api/auth/logout-all',                   minRole: 'USER',       code: 'ESAVI-AUTH-004' },

    // catalogItem
    { method: 'post',   path: '/api/catalog-items',                     minRole: 'ADMIN',      code: 'ESAVI-CATITEM-001' },
    { method: 'get',    path: `/api/catalog-items/type/${ UUID }`,      minRole: 'USER',       code: 'ESAVI-CATITEM-002A' },
    { method: 'get',    path: `/api/catalog-items/admin/type/${ UUID }`, minRole: 'ADMIN',     code: 'ESAVI-CATITEM-002B' },
    { method: 'get',    path: `/api/catalog-items/${ UUID }`,           minRole: 'USER',       code: 'ESAVI-CATITEM-003' },
    { method: 'put',    path: `/api/catalog-items/${ UUID }`,           minRole: 'ADMIN',      code: 'ESAVI-CATITEM-004' },
    { method: 'delete', path: `/api/catalog-items/${ UUID }`,           minRole: 'ADMIN',      code: 'ESAVI-CATITEM-005A' },
    { method: 'patch',  path: `/api/catalog-items/activate/${ UUID }`,  minRole: 'SUPERADMIN', code: 'ESAVI-CATITEM-005B' },
    // ESAVI-CATITEM-006 (SPEC F20) — bulk import from a .xlsx file. SUPERADMIN and not ADMIN like
    // the 001: it is the widest write over the catalog and it also founds rows in catalogType, which
    // is more than an ADMIN can do today without going through the CATTYPE-001
    { method: 'post',   path: '/api/catalog-items/import',              minRole: 'SUPERADMIN', code: 'ESAVI-CATITEM-006' },

    // catalogType
    { method: 'post',   path: '/api/catalog-types',                     minRole: 'ADMIN',      code: 'ESAVI-CATTYPE-001' },
    { method: 'get',    path: '/api/catalog-types',                     minRole: 'USER',       code: 'ESAVI-CATTYPE-002' },
    { method: 'get',    path: `/api/catalog-types/${ UUID }`,           minRole: 'USER',       code: 'ESAVI-CATTYPE-003' },
    { method: 'put',    path: `/api/catalog-types/${ UUID }`,           minRole: 'ADMIN',      code: 'ESAVI-CATTYPE-004' },
    { method: 'delete', path: `/api/catalog-types/${ UUID }`,           minRole: 'ADMIN',      code: 'ESAVI-CATTYPE-005A' },
    { method: 'patch',  path: `/api/catalog-types/activate/${ UUID }`,  minRole: 'SUPERADMIN', code: 'ESAVI-CATTYPE-005B' },

    // geoLevelType
    { method: 'post',   path: '/api/geo-level-types',                    minRole: 'ADMIN',      code: 'ESAVI-GEOLVL-001' },
    { method: 'get',    path: '/api/geo-level-types',                    minRole: 'USER',       code: 'ESAVI-GEOLVL-002' },
    { method: 'get',    path: `/api/geo-level-types/${ UUID }`,          minRole: 'USER',       code: 'ESAVI-GEOLVL-003' },
    { method: 'put',    path: `/api/geo-level-types/${ UUID }`,          minRole: 'ADMIN',      code: 'ESAVI-GEOLVL-004' },
    { method: 'delete', path: `/api/geo-level-types/${ UUID }`,          minRole: 'ADMIN',      code: 'ESAVI-GEOLVL-005A' },
    { method: 'patch',  path: `/api/geo-level-types/activate/${ UUID }`, minRole: 'SUPERADMIN', code: 'ESAVI-GEOLVL-005B' },

    // geoLocation
    { method: 'post',   path: '/api/geo-locations',                      minRole: 'ADMIN',      code: 'ESAVI-GEOLOC-001' },
    { method: 'get',    path: '/api/geo-locations',                      minRole: 'USER',       code: 'ESAVI-GEOLOC-002' },
    { method: 'get',    path: `/api/geo-locations/${ UUID }`,            minRole: 'USER',       code: 'ESAVI-GEOLOC-003' },
    { method: 'put',    path: `/api/geo-locations/${ UUID }`,            minRole: 'ADMIN',      code: 'ESAVI-GEOLOC-004' },
    { method: 'delete', path: `/api/geo-locations/${ UUID }`,            minRole: 'ADMIN',      code: 'ESAVI-GEOLOC-005A' },
    { method: 'patch',  path: `/api/geo-locations/activate/${ UUID }`,   minRole: 'SUPERADMIN', code: 'ESAVI-GEOLOC-005B' },

    // healthFacility
    { method: 'post',   path: '/api/health-facilities',                              minRole: 'ADMIN',      code: 'ESAVI-HFAC-001' },
    { method: 'get',    path: `/api/health-facilities/location/${ UUID }`,           minRole: 'USER',       code: 'ESAVI-HFAC-002A' },
    { method: 'get',    path: `/api/health-facilities/admin/location/${ UUID }`,     minRole: 'ADMIN',      code: 'ESAVI-HFAC-002B' },
    { method: 'get',    path: `/api/health-facilities/${ UUID }`,                    minRole: 'USER',       code: 'ESAVI-HFAC-003' },
    { method: 'put',    path: `/api/health-facilities/${ UUID }`,                    minRole: 'ADMIN',      code: 'ESAVI-HFAC-004' },
    { method: 'delete', path: `/api/health-facilities/${ UUID }`,                    minRole: 'ADMIN',      code: 'ESAVI-HFAC-005A' },
    { method: 'patch',  path: `/api/health-facilities/activate/${ UUID }`,           minRole: 'SUPERADMIN', code: 'ESAVI-HFAC-005B' },

    // appRole
    { method: 'post',   path: '/api/roles',                                           minRole: 'ADMIN',      code: 'ESAVI-APPROLE-001' },
    { method: 'get',    path: '/api/roles',                                           minRole: 'USER',       code: 'ESAVI-APPROLE-002A' },
    { method: 'get',    path: '/api/roles/admin',                                     minRole: 'ADMIN',      code: 'ESAVI-APPROLE-002B' },
    { method: 'get',    path: `/api/roles/${ UUID }`,                                 minRole: 'USER',       code: 'ESAVI-APPROLE-003' },
    { method: 'put',    path: `/api/roles/${ UUID }`,                                 minRole: 'ADMIN',      code: 'ESAVI-APPROLE-004' },
    { method: 'delete', path: `/api/roles/${ UUID }`,                                 minRole: 'ADMIN',      code: 'ESAVI-APPROLE-005A' },
    { method: 'patch',  path: `/api/roles/activate/${ UUID }`,                        minRole: 'SUPERADMIN', code: 'ESAVI-APPROLE-005B' },

    // appUserGeoLocation
    { method: 'post',   path: '/api/user-geo-locations',                              minRole: 'ADMIN',      code: 'ESAVI-USERGEO-001' },
    { method: 'post',   path: '/api/user-geo-locations/bulk',                         minRole: 'ADMIN',      code: 'ESAVI-USERGEO-007' },
    { method: 'get',    path: `/api/user-geo-locations/user/${ UUID }`,               minRole: 'USER',       code: 'ESAVI-USERGEO-002A' },
    { method: 'get',    path: `/api/user-geo-locations/admin/user/${ UUID }`,         minRole: 'ADMIN',      code: 'ESAVI-USERGEO-002B' },
    { method: 'get',    path: `/api/user-geo-locations/user/${ UUID }/coverage`,      minRole: 'USER',       code: 'ESAVI-USERGEO-008' },
    { method: 'get',    path: `/api/user-geo-locations/${ UUID }`,                    minRole: 'USER',       code: 'ESAVI-USERGEO-003' },
    { method: 'put',    path: `/api/user-geo-locations/${ UUID }`,                    minRole: 'ADMIN',      code: 'ESAVI-USERGEO-004' },
    { method: 'patch',  path: `/api/user-geo-locations/reassign/${ UUID }`,           minRole: 'ADMIN',      code: 'ESAVI-USERGEO-006' },
    { method: 'delete', path: `/api/user-geo-locations/${ UUID }`,                    minRole: 'ADMIN',      code: 'ESAVI-USERGEO-005A' },
    { method: 'patch',  path: `/api/user-geo-locations/activate/${ UUID }`,           minRole: 'SUPERADMIN', code: 'ESAVI-USERGEO-005B' },
    { method: 'delete', path: `/api/user-geo-locations/purge/${ UUID }`,              minRole: 'SUPERADMIN', code: 'ESAVI-USERGEO-005C' },

    // appUserRole
    { method: 'post',   path: '/api/user-roles',                          minRole: 'ADMIN',      code: 'ESAVI-USERROLE-001' },
    { method: 'post',   path: '/api/user-roles/bulk',                     minRole: 'ADMIN',      code: 'ESAVI-USERROLE-007' },
    { method: 'get',    path: `/api/user-roles/user/${ UUID }`,           minRole: 'USER',       code: 'ESAVI-USERROLE-002A' },
    { method: 'get',    path: `/api/user-roles/admin/user/${ UUID }`,     minRole: 'ADMIN',      code: 'ESAVI-USERROLE-002B' },
    { method: 'get',    path: `/api/user-roles/role/${ UUID }`,           minRole: 'ADMIN',      code: 'ESAVI-USERROLE-006' },
    { method: 'get',    path: `/api/user-roles/${ UUID }`,                minRole: 'USER',       code: 'ESAVI-USERROLE-003' },
    { method: 'delete', path: `/api/user-roles/${ UUID }`,                minRole: 'ADMIN',      code: 'ESAVI-USERROLE-005A' },
    { method: 'patch',  path: `/api/user-roles/activate/${ UUID }`,       minRole: 'SUPERADMIN', code: 'ESAVI-USERROLE-005B' },

    // user
    { method: 'post',   path: '/api/users',                        minRole: 'ADMIN',      code: 'ESAVI-USER-001' },
    { method: 'get',    path: '/api/users',                        minRole: 'ADMIN',      code: 'ESAVI-USER-002A' },
    { method: 'get',    path: '/api/users/admin',                  minRole: 'ADMIN',      code: 'ESAVI-USER-002B' },
    { method: 'get',    path: '/api/users/me',                     minRole: 'USER',       code: 'ESAVI-USER-007' },
    { method: 'patch',  path: '/api/users/me/password',            minRole: 'USER',       code: 'ESAVI-USER-006' },
    { method: 'get',    path: `/api/users/${ UUID }`,              minRole: 'ADMIN',      code: 'ESAVI-USER-003' },
    { method: 'put',    path: `/api/users/${ UUID }`,              minRole: 'ADMIN',      code: 'ESAVI-USER-004' },
    { method: 'delete', path: `/api/users/${ UUID }`,              minRole: 'ADMIN',      code: 'ESAVI-USER-005A' },
    { method: 'patch',  path: `/api/users/activate/${ UUID }`,     minRole: 'SUPERADMIN', code: 'ESAVI-USER-005B' },

    // patient — 001 and 004 sit at USER on purpose (SPEC F05 §3.4): whoever reports an
    // ESAVI is operational staff and needs to register the patient who does not exist yet
    { method: 'post',   path: '/api/patients',                          minRole: 'USER',       code: 'ESAVI-PATIENT-001' },
    { method: 'get',    path: '/api/patients',                          minRole: 'USER',       code: 'ESAVI-PATIENT-002A' },
    { method: 'get',    path: '/api/patients/admin',                    minRole: 'ADMIN',      code: 'ESAVI-PATIENT-002B' },
    { method: 'get',    path: `/api/patients/search/${ UUID }`,         minRole: 'USER',       code: 'ESAVI-PATIENT-006' },
    { method: 'get',    path: `/api/patients/${ UUID }`,                minRole: 'USER',       code: 'ESAVI-PATIENT-003' },
    { method: 'put',    path: `/api/patients/${ UUID }`,                minRole: 'USER',       code: 'ESAVI-PATIENT-004' },
    { method: 'delete', path: `/api/patients/${ UUID }`,                minRole: 'ADMIN',      code: 'ESAVI-PATIENT-005A' },
    { method: 'patch',  path: `/api/patients/activate/${ UUID }`,       minRole: 'SUPERADMIN', code: 'ESAVI-PATIENT-005B' },

    // esaviCase — 001 and 004 sit at USER for the same reason as patient (SPEC F06 §3.4):
    // whoever opens a case is the operational staff who has just registered the patient
    { method: 'post',   path: '/api/esavi-cases',                       minRole: 'USER',       code: 'ESAVI-CASE-001' },
    { method: 'get',    path: '/api/esavi-cases',                       minRole: 'USER',       code: 'ESAVI-CASE-002A' },
    { method: 'get',    path: '/api/esavi-cases/admin',                 minRole: 'ADMIN',      code: 'ESAVI-CASE-002B' },
    { method: 'get',    path: `/api/esavi-cases/${ UUID }`,             minRole: 'USER',       code: 'ESAVI-CASE-003' },
    { method: 'put',    path: `/api/esavi-cases/${ UUID }`,             minRole: 'USER',       code: 'ESAVI-CASE-004' },
    { method: 'delete', path: `/api/esavi-cases/${ UUID }`,             minRole: 'ADMIN',      code: 'ESAVI-CASE-005A' },
    { method: 'patch',  path: `/api/esavi-cases/activate/${ UUID }`,    minRole: 'SUPERADMIN', code: 'ESAVI-CASE-005B' },

    // notifier — 001 and 004 sit at USER for the same reason as esaviCase (SPEC F07 §3.4):
    // the notifier is captured in the same operational flow as the case. 005C exists because
    // notifier is outside the preventPhysicalDelete loop of esaviapp.sql:1354-1360
    { method: 'post',   path: '/api/notifiers',                          minRole: 'USER',       code: 'ESAVI-NOTIFIER-001' },
    { method: 'get',    path: '/api/notifiers',                          minRole: 'USER',       code: 'ESAVI-NOTIFIER-002A' },
    { method: 'get',    path: '/api/notifiers/admin',                    minRole: 'ADMIN',      code: 'ESAVI-NOTIFIER-002B' },
    { method: 'get',    path: `/api/notifiers/${ UUID }`,                minRole: 'USER',       code: 'ESAVI-NOTIFIER-003' },
    { method: 'put',    path: `/api/notifiers/${ UUID }`,                minRole: 'USER',       code: 'ESAVI-NOTIFIER-004' },
    { method: 'delete', path: `/api/notifiers/${ UUID }`,                minRole: 'ADMIN',      code: 'ESAVI-NOTIFIER-005A' },
    { method: 'patch',  path: `/api/notifiers/activate/${ UUID }`,       minRole: 'SUPERADMIN', code: 'ESAVI-NOTIFIER-005B' },
    { method: 'delete', path: `/api/notifiers/purge/${ UUID }`,          minRole: 'SUPERADMIN', code: 'ESAVI-NOTIFIER-005C' },

    // classification — 001 and 004 sit at USER for the same reason as notifier (SPEC F09 §3.4):
    // classifying is captured in the same operational flow as the case. 006 reads the
    // classification of a case by its caseId, the real query of the domain, and is the only
    // non-canonical operation of the entity. 005C exists because classification is outside the
    // preventPhysicalDelete loop of esaviapp.sql:1354-1360
    { method: 'post',   path: '/api/classifications',                    minRole: 'USER',       code: 'ESAVI-CLASSIF-001' },
    { method: 'get',    path: '/api/classifications',                    minRole: 'USER',       code: 'ESAVI-CLASSIF-002A' },
    { method: 'get',    path: '/api/classifications/admin',              minRole: 'ADMIN',      code: 'ESAVI-CLASSIF-002B' },
    { method: 'get',    path: `/api/classifications/case/${ UUID }`,     minRole: 'USER',       code: 'ESAVI-CLASSIF-006' },
    { method: 'get',    path: `/api/classifications/${ UUID }`,          minRole: 'USER',       code: 'ESAVI-CLASSIF-003' },
    { method: 'put',    path: `/api/classifications/${ UUID }`,          minRole: 'USER',       code: 'ESAVI-CLASSIF-004' },
    { method: 'delete', path: `/api/classifications/${ UUID }`,          minRole: 'ADMIN',      code: 'ESAVI-CLASSIF-005A' },
    { method: 'patch',  path: `/api/classifications/activate/${ UUID }`, minRole: 'SUPERADMIN', code: 'ESAVI-CLASSIF-005B' },
    { method: 'delete', path: `/api/classifications/purge/${ UUID }`,    minRole: 'SUPERADMIN', code: 'ESAVI-CLASSIF-005C' },

    // notification — 001 and 004 sit at USER for the same reason as notifier and classification
    // (SPEC F10 §3.4): notifying is captured in the same operational flow as the case. 006 reads
    // the notification of a case by its caseId, the real query of the domain, and is the only
    // non-canonical operation of the entity. 005C exists because notification is outside the
    // preventPhysicalDelete loop of esaviapp.sql:1363-1366. The abbreviation is NOTIFCN and not
    // NOTIF, which would be a prefix of NOTIFIER and mix both entities in every grep
    { method: 'post',   path: '/api/notifications',                      minRole: 'USER',       code: 'ESAVI-NOTIFCN-001' },
    { method: 'get',    path: '/api/notifications',                      minRole: 'USER',       code: 'ESAVI-NOTIFCN-002A' },
    { method: 'get',    path: '/api/notifications/admin',                minRole: 'ADMIN',      code: 'ESAVI-NOTIFCN-002B' },
    { method: 'get',    path: `/api/notifications/case/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-NOTIFCN-006' },
    { method: 'get',    path: `/api/notifications/${ UUID }`,            minRole: 'USER',       code: 'ESAVI-NOTIFCN-003' },
    { method: 'put',    path: `/api/notifications/${ UUID }`,            minRole: 'USER',       code: 'ESAVI-NOTIFCN-004' },
    { method: 'delete', path: `/api/notifications/${ UUID }`,            minRole: 'ADMIN',      code: 'ESAVI-NOTIFCN-005A' },
    { method: 'patch',  path: `/api/notifications/activate/${ UUID }`,   minRole: 'SUPERADMIN', code: 'ESAVI-NOTIFCN-005B' },
    { method: 'delete', path: `/api/notifications/purge/${ UUID }`,      minRole: 'SUPERADMIN', code: 'ESAVI-NOTIFCN-005C' },

    // severeNotification — five operations and not seven, and the first entity of the repository
    // with none in ADMIN (SPEC F13 §3.4). The table has no isActive column, so the entity does not
    // manage its own state — its header does — and there is no 005A or 005B to expose: retiring
    // the detail is retiring the notification. There is no 002 either, in any variant: without
    // isActive the two halves of the dual listing would return exactly the same rows. 001, 003,
    // 004 and 006 stay in USER for the same reason as the notification itself, the clinical detail
    // being captured in the same operational flow, and 005C stays in SUPERADMIN as §6 requires
    { method: 'post',   path: '/api/severe-notifications',                    minRole: 'USER',       code: 'ESAVI-SEVNOT-001' },
    { method: 'get',    path: `/api/severe-notifications/case/${ UUID }`,     minRole: 'USER',       code: 'ESAVI-SEVNOT-006' },
    { method: 'delete', path: `/api/severe-notifications/purge/${ UUID }`,    minRole: 'SUPERADMIN', code: 'ESAVI-SEVNOT-005C' },
    { method: 'get',    path: `/api/severe-notifications/${ UUID }`,          minRole: 'USER',       code: 'ESAVI-SEVNOT-003' },
    { method: 'put',    path: `/api/severe-notifications/${ UUID }`,          minRole: 'USER',       code: 'ESAVI-SEVNOT-004' },

    // nonSevereNotification — the same five operations and the same absences, for the same reason
    // (SPEC F14 §3.4). It is the second entity of the repository without an isActive column and
    // the second with none in ADMIN: the only canonical operation that would land there, 005A,
    // does not exist here either. The roles are identical to those of its severe sibling because
    // the detail is captured in the same operational flow as the notification
    { method: 'post',   path: '/api/non-severe-notifications',                 minRole: 'USER',       code: 'ESAVI-NSEVNOT-001' },
    { method: 'get',    path: `/api/non-severe-notifications/case/${ UUID }`,  minRole: 'USER',       code: 'ESAVI-NSEVNOT-006' },
    { method: 'delete', path: `/api/non-severe-notifications/purge/${ UUID }`, minRole: 'SUPERADMIN', code: 'ESAVI-NSEVNOT-005C' },
    { method: 'get',    path: `/api/non-severe-notifications/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-NSEVNOT-003' },
    { method: 'put',    path: `/api/non-severe-notifications/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-NSEVNOT-004' },

    // diagnosticTerm — the seven canonical operations, with the canonical role matrix and no
    // deviation (SPEC F15 §3.4). No 005C: the table sits inside the preventPhysicalDelete loop of
    // esaviapp.sql:1356-1370, so physical deletion is not declared. ESAVI-DIAGTERM-006 has no row
    // here on purpose — it is the implicit resolution service, invoked by other domains inside
    // their own transaction, and it has no HTTP route to authorize
    { method: 'post',   path: '/api/diagnostic-terms',                        minRole: 'ADMIN',      code: 'ESAVI-DIAGTERM-001' },
    { method: 'get',    path: '/api/diagnostic-terms',                        minRole: 'USER',       code: 'ESAVI-DIAGTERM-002A' },
    { method: 'get',    path: '/api/diagnostic-terms/admin',                  minRole: 'ADMIN',      code: 'ESAVI-DIAGTERM-002B' },
    { method: 'get',    path: `/api/diagnostic-terms/${ UUID }`,              minRole: 'USER',       code: 'ESAVI-DIAGTERM-003' },
    { method: 'put',    path: `/api/diagnostic-terms/${ UUID }`,              minRole: 'ADMIN',      code: 'ESAVI-DIAGTERM-004' },
    { method: 'delete', path: `/api/diagnostic-terms/${ UUID }`,              minRole: 'ADMIN',      code: 'ESAVI-DIAGTERM-005A' },
    { method: 'patch',  path: `/api/diagnostic-terms/activate/${ UUID }`,     minRole: 'SUPERADMIN', code: 'ESAVI-DIAGTERM-005B' },
    // ESAVI-DIAGTERM-007 (SPEC F17) — bulk import from a MedDRA .asc file. SUPERADMIN because it is
    // the widest write of the repository: tens of thousands of rows in a single request
    { method: 'post',   path: '/api/diagnostic-terms/import',                 minRole: 'SUPERADMIN', code: 'ESAVI-DIAGTERM-007' },

    // notificationEvent (SPEC F16) — the first satellite of notification with one to many
    // cardinality, its own activity flag and order among siblings, so it declares the eight
    // canonical operations and not five. 005C is declared because the table sits outside the
    // preventPhysicalDelete loop of esaviapp.sql:1355-1361.
    // ESAVI-NOTIFEVT-006 does have a row here, unlike the 006 of DIAGTERM: it is a read with an
    // HTTP route of its own. The two listings are entered by the foreign key and never by /
    { method: 'post',   path: '/api/notification-events',                              minRole: 'ADMIN',      code: 'ESAVI-NOTIFEVT-001' },
    { method: 'get',    path: `/api/notification-events/case/${ UUID }`,               minRole: 'USER',       code: 'ESAVI-NOTIFEVT-006' },
    { method: 'get',    path: `/api/notification-events/admin/notification/${ UUID }`, minRole: 'ADMIN',      code: 'ESAVI-NOTIFEVT-002B' },
    { method: 'get',    path: `/api/notification-events/notification/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-NOTIFEVT-002A' },
    { method: 'delete', path: `/api/notification-events/purge/${ UUID }`,              minRole: 'SUPERADMIN', code: 'ESAVI-NOTIFEVT-005C' },
    { method: 'patch',  path: `/api/notification-events/activate/${ UUID }`,           minRole: 'SUPERADMIN', code: 'ESAVI-NOTIFEVT-005B' },
    { method: 'get',    path: `/api/notification-events/${ UUID }`,                    minRole: 'USER',       code: 'ESAVI-NOTIFEVT-003' },
    { method: 'put',    path: `/api/notification-events/${ UUID }`,                    minRole: 'ADMIN',      code: 'ESAVI-NOTIFEVT-004' },
    { method: 'delete', path: `/api/notification-events/${ UUID }`,                    minRole: 'ADMIN',      code: 'ESAVI-NOTIFEVT-005A' },

    // notificationMedication (SPEC F21) — the fourth satellite of notification and the second one to
    // many, so it repeats the surface of notificationEvent without variation: eight canonical
    // operations and not five. 005C is declared because the table sits outside the
    // preventPhysicalDelete loop of esaviapp.sql:1358-1375.
    // ESAVI-NOTIFMED-006 does have a row here, for the same reason the 006 of NOTIFEVT does: it is a
    // read with an HTTP route of its own. The two listings are entered by the foreign key and never
    // by /
    { method: 'post',   path: '/api/notification-medications',                              minRole: 'ADMIN',      code: 'ESAVI-NOTIFMED-001' },
    { method: 'get',    path: `/api/notification-medications/case/${ UUID }`,               minRole: 'USER',       code: 'ESAVI-NOTIFMED-006' },
    { method: 'get',    path: `/api/notification-medications/admin/notification/${ UUID }`, minRole: 'ADMIN',      code: 'ESAVI-NOTIFMED-002B' },
    { method: 'get',    path: `/api/notification-medications/notification/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-NOTIFMED-002A' },
    { method: 'delete', path: `/api/notification-medications/purge/${ UUID }`,              minRole: 'SUPERADMIN', code: 'ESAVI-NOTIFMED-005C' },
    { method: 'patch',  path: `/api/notification-medications/activate/${ UUID }`,           minRole: 'SUPERADMIN', code: 'ESAVI-NOTIFMED-005B' },
    { method: 'get',    path: `/api/notification-medications/${ UUID }`,                    minRole: 'USER',       code: 'ESAVI-NOTIFMED-003' },
    { method: 'put',    path: `/api/notification-medications/${ UUID }`,                    minRole: 'ADMIN',      code: 'ESAVI-NOTIFMED-004' },
    { method: 'delete', path: `/api/notification-medications/${ UUID }`,                    minRole: 'ADMIN',      code: 'ESAVI-NOTIFMED-005A' },

    // vaccineWhodrug (SPEC F18) — the seven canonical operations, with the canonical role matrix
    // and no deviation (§3.4). No 005C: the table sits inside the preventPhysicalDelete loop of
    // esaviapp.sql:1356-1370, so physical deletion is not declared. The base path deliberately
    // diverges from the table name — the catalog holds vaccines of the WHODrug dictionary, and that
    // is the order an API consumer looks for them in
    { method: 'post',   path: '/api/whodrug-vaccines',                        minRole: 'ADMIN',      code: 'ESAVI-WHODRUG-001' },
    { method: 'get',    path: '/api/whodrug-vaccines',                        minRole: 'USER',       code: 'ESAVI-WHODRUG-002A' },
    { method: 'get',    path: '/api/whodrug-vaccines/admin',                  minRole: 'ADMIN',      code: 'ESAVI-WHODRUG-002B' },
    { method: 'get',    path: `/api/whodrug-vaccines/${ UUID }`,              minRole: 'USER',       code: 'ESAVI-WHODRUG-003' },
    { method: 'put',    path: `/api/whodrug-vaccines/${ UUID }`,              minRole: 'ADMIN',      code: 'ESAVI-WHODRUG-004' },
    { method: 'delete', path: `/api/whodrug-vaccines/${ UUID }`,              minRole: 'ADMIN',      code: 'ESAVI-WHODRUG-005A' },
    { method: 'patch',  path: `/api/whodrug-vaccines/activate/${ UUID }`,     minRole: 'SUPERADMIN', code: 'ESAVI-WHODRUG-005B' },

    // ESAVI-WHODRUG-007 (SPEC F19) — bulk import from a WHODrug .xlsx file. SUPERADMIN, same as the
    // .asc importer: it is the widest write over the entity, and the 005B already reserved the role
    // for moving a single row
    { method: 'post',   path: '/api/whodrug-vaccines/import',                 minRole: 'SUPERADMIN', code: 'ESAVI-WHODRUG-007' },

    // notificationVaccine (SPEC F22) — the fifth satellite of notification and the third of the one
    // to many family, so it repeats the nine rows of NOTIFEVT and NOTIFMED with the canonical role
    // matrix. The 005C exists because the table sits outside the preventPhysicalDelete loop of
    // esaviapp.sql:1361-1373.
    // ESAVI-NOTIFVAC-006 does have a row here, for the same reason the 006 of NOTIFEVT and NOTIFMED
    // do: it is a read with an HTTP route of its own. The two listings are entered by the foreign
    // key and never by /
    { method: 'post',   path: '/api/notification-vaccines',                              minRole: 'ADMIN',      code: 'ESAVI-NOTIFVAC-001' },
    { method: 'get',    path: `/api/notification-vaccines/case/${ UUID }`,               minRole: 'USER',       code: 'ESAVI-NOTIFVAC-006' },
    { method: 'get',    path: `/api/notification-vaccines/admin/notification/${ UUID }`, minRole: 'ADMIN',      code: 'ESAVI-NOTIFVAC-002B' },
    { method: 'get',    path: `/api/notification-vaccines/notification/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-NOTIFVAC-002A' },
    { method: 'delete', path: `/api/notification-vaccines/purge/${ UUID }`,              minRole: 'SUPERADMIN', code: 'ESAVI-NOTIFVAC-005C' },
    { method: 'patch',  path: `/api/notification-vaccines/activate/${ UUID }`,           minRole: 'SUPERADMIN', code: 'ESAVI-NOTIFVAC-005B' },
    { method: 'get',    path: `/api/notification-vaccines/${ UUID }`,                    minRole: 'USER',       code: 'ESAVI-NOTIFVAC-003' },
    { method: 'put',    path: `/api/notification-vaccines/${ UUID }`,                    minRole: 'ADMIN',      code: 'ESAVI-NOTIFVAC-004' },
    { method: 'delete', path: `/api/notification-vaccines/${ UUID }`,                    minRole: 'ADMIN',      code: 'ESAVI-NOTIFVAC-005A' },

    // diluentCatalog (SPEC F23) — the third and last of the flat clinical catalogs, so it repeats the
    // seven rows of DIAGTERM and WHODRUG with the canonical role matrix and no deviation (§3.4).
    // No 005C: the table sits inside the preventPhysicalDelete loop of esaviapp.sql:1361-1375, so
    // physical deletion is not declared. No 006 either — there is no implicit resolution and no bulk
    // import. The base path deliberately diverges from the table name: what the catalog holds are
    // diluents, and 'catalog' names the container rather than the resource
    { method: 'post',   path: '/api/diluents',                                           minRole: 'ADMIN',      code: 'ESAVI-DILUENT-001' },
    { method: 'get',    path: '/api/diluents',                                           minRole: 'USER',       code: 'ESAVI-DILUENT-002A' },
    { method: 'get',    path: '/api/diluents/admin',                                     minRole: 'ADMIN',      code: 'ESAVI-DILUENT-002B' },
    { method: 'get',    path: `/api/diluents/${ UUID }`,                                 minRole: 'USER',       code: 'ESAVI-DILUENT-003' },
    { method: 'put',    path: `/api/diluents/${ UUID }`,                                 minRole: 'ADMIN',      code: 'ESAVI-DILUENT-004' },
    { method: 'delete', path: `/api/diluents/${ UUID }`,                                 minRole: 'ADMIN',      code: 'ESAVI-DILUENT-005A' },
    { method: 'patch',  path: `/api/diluents/activate/${ UUID }`,                        minRole: 'SUPERADMIN', code: 'ESAVI-DILUENT-005B' },

    // notificationDiluent (SPEC F24) — the sixth satellite of notification and the first grandchild
    // of the graph: it hangs from vaccineId, so its inherited visibility is two hops instead of one.
    // Eight canonical operations with the role matrix of NOTIFVAC, and no 006 of any kind: flattening
    // a two level fan out would mix rows of different vaccines under a sortOrder relative to each of
    // them, so this is the first of the family that adds no row to the non-canonical table.
    // The 005C exists because the table is outside the preventPhysicalDelete loop of
    // esaviapp.sql:1361-1375. The two listings are entered by the foreign key and never by /
    { method: 'post',   path: '/api/notification-diluents',                              minRole: 'ADMIN',      code: 'ESAVI-NOTIFDIL-001' },
    { method: 'get',    path: `/api/notification-diluents/admin/vaccine/${ UUID }`,      minRole: 'ADMIN',      code: 'ESAVI-NOTIFDIL-002B' },
    { method: 'get',    path: `/api/notification-diluents/vaccine/${ UUID }`,            minRole: 'USER',       code: 'ESAVI-NOTIFDIL-002A' },
    { method: 'delete', path: `/api/notification-diluents/purge/${ UUID }`,              minRole: 'SUPERADMIN', code: 'ESAVI-NOTIFDIL-005C' },
    { method: 'patch',  path: `/api/notification-diluents/activate/${ UUID }`,           minRole: 'SUPERADMIN', code: 'ESAVI-NOTIFDIL-005B' },
    { method: 'get',    path: `/api/notification-diluents/${ UUID }`,                    minRole: 'USER',       code: 'ESAVI-NOTIFDIL-003' },
    { method: 'put',    path: `/api/notification-diluents/${ UUID }`,                    minRole: 'ADMIN',      code: 'ESAVI-NOTIFDIL-004' },
    { method: 'delete', path: `/api/notification-diluents/${ UUID }`,                    minRole: 'ADMIN',      code: 'ESAVI-NOTIFDIL-005A' },

    // notificationPregnancy (SPEC F25) — the seventh satellite of notification, and a shape none of
    // the six before it had: one to one *and* with its own state. severeNotification and
    // nonSevereNotification are one to one but share the primary key and carry no isActive, so they
    // have no activation pair; the four one to many sisters have state but drag an ordering column.
    // This one has its own pregnancyId, a plain UNIQUE over the foreign key and an isActive, which is
    // where its surface comes from: SEVEN rows, with the full activation pair and NO 002 in any form —
    // a listing of at most one row has no reader, so the 006 enters by notificationId and returns a
    // single object.
    // 001, 003, 004 and 006 run as USER, the deviation the clinical detail entities fixed: the
    // pregnancy section is captured in the same operational flow as the notification.
    // The 005C exists because the table is outside the preventPhysicalDelete loop of
    // esaviapp.sql:1361-1375, and purging drags notificationPregnancyComplication with it
    { method: 'post',   path: '/api/notification-pregnancies',                            minRole: 'USER',       code: 'ESAVI-NOTIFPRG-001' },
    { method: 'get',    path: `/api/notification-pregnancies/notification/${ UUID }`,     minRole: 'USER',       code: 'ESAVI-NOTIFPRG-006' },
    { method: 'delete', path: `/api/notification-pregnancies/purge/${ UUID }`,            minRole: 'SUPERADMIN', code: 'ESAVI-NOTIFPRG-005C' },
    { method: 'patch',  path: `/api/notification-pregnancies/activate/${ UUID }`,         minRole: 'SUPERADMIN', code: 'ESAVI-NOTIFPRG-005B' },
    { method: 'get',    path: `/api/notification-pregnancies/${ UUID }`,                  minRole: 'USER',       code: 'ESAVI-NOTIFPRG-003' },
    { method: 'put',    path: `/api/notification-pregnancies/${ UUID }`,                  minRole: 'USER',       code: 'ESAVI-NOTIFPRG-004' },
    { method: 'delete', path: `/api/notification-pregnancies/${ UUID }`,                  minRole: 'ADMIN',      code: 'ESAVI-NOTIFPRG-005A' },

    // notificationPregnancyComplication (SPEC F27) — the eighth and last satellite of notification,
    // and a granddaughter like notificationDiluent but of a different shape: the first hop is one to
    // one, because UQ_notificationPregnancy_notification allows a single pregnancy per notification,
    // so the fan out only opens at the second level. EIGHT rows and NO 006 in any form: the entry is
    // pregnancyId, which the ESAVI-NOTIFPRG-006 above already returns to whoever opens the pregnancy
    // form.
    // 001, 002A, 003 and 004 run as USER, following the parent F25 and not F24: the complication is
    // captured in the same pregnancy form as the parent row, and splitting the form between two roles
    // would break the capture in half.
    // The 005C exists because the table is outside the preventPhysicalDelete loop, and it drags
    // nothing: the table is a leaf of the graph
    { method: 'post',   path: '/api/notification-pregnancy-complications',                 minRole: 'USER',       code: 'ESAVI-PREGCOMP-001' },
    { method: 'get',    path: `/api/notification-pregnancy-complications/admin/pregnancy/${ UUID }`, minRole: 'ADMIN', code: 'ESAVI-PREGCOMP-002B' },
    { method: 'get',    path: `/api/notification-pregnancy-complications/pregnancy/${ UUID }`,       minRole: 'USER',  code: 'ESAVI-PREGCOMP-002A' },
    { method: 'delete', path: `/api/notification-pregnancy-complications/purge/${ UUID }`,    minRole: 'SUPERADMIN', code: 'ESAVI-PREGCOMP-005C' },
    { method: 'patch',  path: `/api/notification-pregnancy-complications/activate/${ UUID }`, minRole: 'SUPERADMIN', code: 'ESAVI-PREGCOMP-005B' },
    { method: 'get',    path: `/api/notification-pregnancy-complications/${ UUID }`,         minRole: 'USER',       code: 'ESAVI-PREGCOMP-003' },
    { method: 'put',    path: `/api/notification-pregnancy-complications/${ UUID }`,         minRole: 'USER',       code: 'ESAVI-PREGCOMP-004' },
    { method: 'delete', path: `/api/notification-pregnancy-complications/${ UUID }`,         minRole: 'ADMIN',      code: 'ESAVI-PREGCOMP-005A' },

    // investigation (SPEC F28) — the root of the investigation block and the fourth satellite of
    // esaviCase, one to one with it through UQ_investigation_case. Seven canonical operations plus
    // 006, which reads by the caseId because that is what the client holds, and 005C, which the
    // entity gets for sitting outside the preventPhysicalDelete loop of esaviapp.sql.
    // 001 and 004 deviate from the canonical matrix and stay in USER, the same deviation as F05,
    // F06, F07, F09 and F10 and for the same reason: the investigation is captured in the same
    // operational flow as the case. Its fourteen satellite tables are out of scope of F28
    { method: 'post',   path: '/api/investigations',                    minRole: 'USER',       code: 'ESAVI-INVESTGN-001' },
    { method: 'get',    path: '/api/investigations',                    minRole: 'USER',       code: 'ESAVI-INVESTGN-002A' },
    { method: 'get',    path: '/api/investigations/admin',              minRole: 'ADMIN',      code: 'ESAVI-INVESTGN-002B' },
    { method: 'get',    path: `/api/investigations/case/${ UUID }`,     minRole: 'USER',       code: 'ESAVI-INVESTGN-006' },
    { method: 'get',    path: `/api/investigations/${ UUID }`,          minRole: 'USER',       code: 'ESAVI-INVESTGN-003' },
    { method: 'put',    path: `/api/investigations/${ UUID }`,          minRole: 'USER',       code: 'ESAVI-INVESTGN-004' },
    { method: 'delete', path: `/api/investigations/${ UUID }`,          minRole: 'ADMIN',      code: 'ESAVI-INVESTGN-005A' },
    { method: 'patch',  path: `/api/investigations/activate/${ UUID }`, minRole: 'SUPERADMIN', code: 'ESAVI-INVESTGN-005B' },
    { method: 'delete', path: `/api/investigations/purge/${ UUID }`,    minRole: 'SUPERADMIN', code: 'ESAVI-INVESTGN-005C' },

    // investigationSource (SPEC F29) — the first of the fourteen satellites of investigation, and
    // the third table of the repository with no isActive column. Seven operations and not nine:
    // there is no 005A and no 005B, because without an activity flag there is no state of its own
    // to activate — retiring a source is retiring its investigation. It does keep the dual listing
    // its two elder sisters gave up, since the visibility is inherited from investigation.isActive
    // and the two variants therefore return different rows. 001 and 004 stay on USER, the same
    // deviation as above and for the same reason
    { method: 'post',   path: '/api/investigation-sources',                 minRole: 'USER',       code: 'ESAVI-INVSRC-001' },
    { method: 'get',    path: '/api/investigation-sources',                 minRole: 'USER',       code: 'ESAVI-INVSRC-002A' },
    { method: 'get',    path: '/api/investigation-sources/admin',           minRole: 'ADMIN',      code: 'ESAVI-INVSRC-002B' },
    { method: 'get',    path: `/api/investigation-sources/case/${ UUID }`,  minRole: 'USER',       code: 'ESAVI-INVSRC-006' },
    { method: 'get',    path: `/api/investigation-sources/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-INVSRC-003' },
    { method: 'put',    path: `/api/investigation-sources/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-INVSRC-004' },
    { method: 'delete', path: `/api/investigation-sources/purge/${ UUID }`, minRole: 'SUPERADMIN', code: 'ESAVI-INVSRC-005C' },

    // investigationAutopsy (SPEC F30) — the second of the fourteen satellites of investigation, and
    // the fourth table of the repository with no isActive column. The same seven operations as its
    // sister and for the same reasons: no 005A and no 005B, the dual listing kept because the
    // visibility is inherited from investigation.isActive, and 001 and 004 on USER. The :id of
    // 003, 004 and 005C is the investigationId — the primary key of the row is the foreign key to
    // its investigation — so the 003 is already the access by investigation and the 006 exists to
    // walk case -> investigation -> autopsy, one to one on both hops
    { method: 'post',   path: '/api/investigation-autopsies',                 minRole: 'USER',       code: 'ESAVI-INVAUT-001' },
    { method: 'get',    path: '/api/investigation-autopsies',                 minRole: 'USER',       code: 'ESAVI-INVAUT-002A' },
    { method: 'get',    path: '/api/investigation-autopsies/admin',           minRole: 'ADMIN',      code: 'ESAVI-INVAUT-002B' },
    { method: 'get',    path: `/api/investigation-autopsies/case/${ UUID }`,  minRole: 'USER',       code: 'ESAVI-INVAUT-006' },
    { method: 'get',    path: `/api/investigation-autopsies/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-INVAUT-003' },
    { method: 'put',    path: `/api/investigation-autopsies/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-INVAUT-004' },
    { method: 'delete', path: `/api/investigation-autopsies/purge/${ UUID }`, minRole: 'SUPERADMIN', code: 'ESAVI-INVAUT-005C' },

    // investigationTeamMember (SPEC F31) — who investigated the case, the third satellite of
    // investigation and the FIRST of them that is a collection with state of its own. It is the
    // first with an isActive column, and with it the seven canonical operations come back: unlike
    // its two sisters it does have a 005A and a 005B, because retiring a person from the team is a
    // fact of the domain and not a consequence of its parent being withdrawn. No cascade from
    // investigation or from esaviCase ever writes that column.
    // NINE ROWS: the seven canonical ones, the 005C of physical delete, and the non-canonical 006
    // that walks case -> investigation, one to one, and opens into the N members hanging from it.
    // The :id is the investigationTeamMemberId and NOT the investigationId, so 003 is the access by
    // member and the access by investigation is the pair of listings 002A / 002B, entered by the
    // parent and with no filter at all.
    // TWO ROWS DEVIATE from the canonical matrix. 001 and 004 on USER, the same deviation as F05,
    // F06, F07, F09, F10, F13, F14, F28, F29 and F30: the detail is captured in the same
    // operational flow as the case. And 005B on ADMIN and not SUPERADMIN, following F27: the
    // activation of this entity is not the trivial delegation the matrix assumes but an operation
    // carrying a sortOrder reassignment in a transaction
    { method: 'post',   path: '/api/investigation-team-members',                                  minRole: 'USER',       code: 'ESAVI-INVTEAM-001' },
    { method: 'get',    path: `/api/investigation-team-members/admin/investigation/${ UUID }`,    minRole: 'ADMIN',      code: 'ESAVI-INVTEAM-002B' },
    { method: 'get',    path: `/api/investigation-team-members/investigation/${ UUID }`,          minRole: 'USER',       code: 'ESAVI-INVTEAM-002A' },
    { method: 'get',    path: `/api/investigation-team-members/case/${ UUID }`,                   minRole: 'USER',       code: 'ESAVI-INVTEAM-006' },
    { method: 'delete', path: `/api/investigation-team-members/purge/${ UUID }`,                  minRole: 'SUPERADMIN', code: 'ESAVI-INVTEAM-005C' },
    { method: 'patch',  path: `/api/investigation-team-members/activate/${ UUID }`,               minRole: 'ADMIN',      code: 'ESAVI-INVTEAM-005B' },
    { method: 'get',    path: `/api/investigation-team-members/${ UUID }`,                        minRole: 'USER',       code: 'ESAVI-INVTEAM-003' },
    { method: 'put',    path: `/api/investigation-team-members/${ UUID }`,                        minRole: 'USER',       code: 'ESAVI-INVTEAM-004' },
    { method: 'delete', path: `/api/investigation-team-members/${ UUID }`,                        minRole: 'ADMIN',      code: 'ESAVI-INVTEAM-005A' },

    // investigationMedicalHistory (SPEC F32) — the fourth of the fourteen satellites of
    // investigation, and the third one without an isActive column of its own. SEVEN operations and
    // NO 005A or 005B: the entity has no state to activate, so retiring a medical history is
    // retiring its investigation. The dual listing is inherited from F29 and F30 — the visibility
    // comes from investigation.isActive, so 002A and 002B return different sets.
    // TWO ROWS DEVIATE from the canonical matrix, and they are the same deviation as F05, F06, F07,
    // F09, F10, F13, F14, F28, F29, F30 and F31: 001 and 004 on USER, because the anamnesis is
    // captured in the same operational flow as the case
    { method: 'post',   path: '/api/investigation-medical-histories',                 minRole: 'USER',       code: 'ESAVI-INVMEDH-001' },
    { method: 'get',    path: '/api/investigation-medical-histories',                 minRole: 'USER',       code: 'ESAVI-INVMEDH-002A' },
    { method: 'get',    path: '/api/investigation-medical-histories/admin',           minRole: 'ADMIN',      code: 'ESAVI-INVMEDH-002B' },
    { method: 'delete', path: `/api/investigation-medical-histories/purge/${ UUID }`, minRole: 'SUPERADMIN', code: 'ESAVI-INVMEDH-005C' },
    { method: 'get',    path: `/api/investigation-medical-histories/case/${ UUID }`,  minRole: 'USER',       code: 'ESAVI-INVMEDH-006' },
    { method: 'get',    path: `/api/investigation-medical-histories/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-INVMEDH-003' },
    { method: 'put',    path: `/api/investigation-medical-histories/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-INVMEDH-004' },

    // investigationPregnancyCondition (SPEC F33) — the FIRST GRANDDAUGHTER of the investigation
    // block: its foreign key points at investigationMedicalHistory and not at investigation, even
    // though the column is called investigationId. EIGHT operations and no 006, like F24 and F27:
    // the entry is the investigationId, which is at once the primary key of the medical history and
    // the one ESAVI-INVESTGN-006 already returns from the caseId.
    // FOUR ROWS DEVIATE from the canonical matrix. 001, 002A, 003 and 004 on USER, the same
    // deviation as F05, F06, F07, F09, F10, F13, F14, F28, F29, F30, F31 and F32: the condition is
    // captured in the same operational flow as the case. And 005B on ADMIN and not SUPERADMIN,
    // following F27 and F31: the activation carries a sortOrder reassignment inside a transaction,
    // so it is case administration and not the trivial delegation the matrix assumes
    { method: 'post',   path: '/api/investigation-pregnancy-conditions',                                  minRole: 'USER',       code: 'ESAVI-INVPREG-001' },
    { method: 'get',    path: `/api/investigation-pregnancy-conditions/admin/investigation/${ UUID }`,    minRole: 'ADMIN',      code: 'ESAVI-INVPREG-002B' },
    { method: 'get',    path: `/api/investigation-pregnancy-conditions/investigation/${ UUID }`,          minRole: 'USER',       code: 'ESAVI-INVPREG-002A' },
    { method: 'delete', path: `/api/investigation-pregnancy-conditions/purge/${ UUID }`,                  minRole: 'SUPERADMIN', code: 'ESAVI-INVPREG-005C' },
    { method: 'patch',  path: `/api/investigation-pregnancy-conditions/activate/${ UUID }`,               minRole: 'ADMIN',      code: 'ESAVI-INVPREG-005B' },
    { method: 'get',    path: `/api/investigation-pregnancy-conditions/${ UUID }`,                        minRole: 'USER',       code: 'ESAVI-INVPREG-003' },
    { method: 'put',    path: `/api/investigation-pregnancy-conditions/${ UUID }`,                        minRole: 'USER',       code: 'ESAVI-INVPREG-004' },
    { method: 'delete', path: `/api/investigation-pregnancy-conditions/${ UUID }`,                        minRole: 'ADMIN',      code: 'ESAVI-INVPREG-005A' },

    // investigationClinicalEvaluation (SPEC F34) — the fifth of the fourteen satellites of
    // investigation, and the fourth one without an isActive column of its own. SEVEN operations and
    // NO 005A or 005B: the entity has no state to activate, so retiring a clinical evaluation is
    // retiring its investigation. The dual listing is inherited from F29, F30 and F32 — the
    // visibility comes from investigation.isActive, so 002A and 002B return different sets.
    // TWO ROWS DEVIATE from the canonical matrix, and they are the same deviation as F05, F06, F07,
    // F09, F10, F13, F14, F28, F29, F30, F31, F32 and F33: 001 and 004 on USER, because the clinical
    // evaluation is captured in the same operational flow as the case.
    // The encrypted clinicalDetailsPersonName does NOT raise any minimum: what protects the column
    // is the encryption at rest, not a stricter role — a USER completing the form has to be able to
    // write the name it just collected
    { method: 'post',   path: '/api/investigation-clinical-evaluations',                 minRole: 'USER',       code: 'ESAVI-INVCLIEV-001' },
    { method: 'get',    path: '/api/investigation-clinical-evaluations',                 minRole: 'USER',       code: 'ESAVI-INVCLIEV-002A' },
    { method: 'get',    path: '/api/investigation-clinical-evaluations/admin',           minRole: 'ADMIN',      code: 'ESAVI-INVCLIEV-002B' },
    { method: 'delete', path: `/api/investigation-clinical-evaluations/purge/${ UUID }`, minRole: 'SUPERADMIN', code: 'ESAVI-INVCLIEV-005C' },
    { method: 'get',    path: `/api/investigation-clinical-evaluations/case/${ UUID }`,  minRole: 'USER',       code: 'ESAVI-INVCLIEV-006' },
    { method: 'get',    path: `/api/investigation-clinical-evaluations/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-INVCLIEV-003' },
    { method: 'put',    path: `/api/investigation-clinical-evaluations/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-INVCLIEV-004' },

    // evaluationInstitution (SPEC F35) — the second granddaughter of the investigation block and the
    // first one hanging from the clinical evaluation. EIGHT operations and no 006: the entry is by
    // /investigation/:id, and that :id is the one ESAVI-INVCLIEV-006 already returns from the caseId,
    // so a 006 of its own would duplicate the guard chain to save a call the client already makes.
    // FOUR ROWS DEVIATE from the canonical matrix, the same deviation as F05, F06, F07, F09, F10,
    // F13, F14 and F28 to F34: 001, 002A, 003 and 004 on USER, because the institution is captured in
    // the same operational flow as the case.
    // AND A FIFTH: 005B on ADMIN and not on SUPERADMIN, following F27, F31 and F33 — the activation
    // of this entity is not the trivial delegation the canonical matrix assumes but an operation
    // carrying a sortOrder reassignment inside a transaction, and whoever administers the case must
    // be able to run it.
    // The encrypted personName and personContact do NOT raise any minimum: what protects the columns
    // is the encryption at rest, not a stricter role — a USER completing the form has to be able to
    // write the contact it just collected
    { method: 'post',   path: '/api/evaluation-institutions',                                minRole: 'USER',       code: 'ESAVI-EVALINST-001' },
    { method: 'get',    path: `/api/evaluation-institutions/admin/investigation/${ UUID }`,  minRole: 'ADMIN',      code: 'ESAVI-EVALINST-002B' },
    { method: 'get',    path: `/api/evaluation-institutions/investigation/${ UUID }`,        minRole: 'USER',       code: 'ESAVI-EVALINST-002A' },
    { method: 'delete', path: `/api/evaluation-institutions/purge/${ UUID }`,                minRole: 'SUPERADMIN', code: 'ESAVI-EVALINST-005C' },
    { method: 'patch',  path: `/api/evaluation-institutions/activate/${ UUID }`,             minRole: 'ADMIN',      code: 'ESAVI-EVALINST-005B' },
    { method: 'get',    path: `/api/evaluation-institutions/${ UUID }`,                      minRole: 'USER',       code: 'ESAVI-EVALINST-003' },
    { method: 'put',    path: `/api/evaluation-institutions/${ UUID }`,                      minRole: 'USER',       code: 'ESAVI-EVALINST-004' },
    { method: 'delete', path: `/api/evaluation-institutions/${ UUID }`,                      minRole: 'ADMIN',      code: 'ESAVI-EVALINST-005A' },

    // investigationVaccinationContext (SPEC F36) - the sixth satellite of investigation with a spec
    // of its own: the context of the vaccination session in which the investigated dose was
    // administered. SEVEN operations and NO 005A or 005B: the table has no isActive column, so there
    // is no state of its own to activate or deactivate - retiring a vaccination context is retiring
    // its investigation. Its 006 enters by the caseId and walks case -> investigation -> context.
    // TWO ROWS DEVIATE from the canonical matrix, the same deviation as F05, F06, F07, F09, F10,
    // F13, F14 and F28 to F35: 001 and 004 on USER, because the context is captured in the same
    // operational flow as the case.
    // Nothing here is encrypted: the eleven data columns are operational data of a session, with no
    // person's name among them, so no row raises its minimum for that reason
    { method: 'post',   path: '/api/investigation-vaccination-contexts',                 minRole: 'USER',       code: 'ESAVI-INVVACTX-001' },
    { method: 'get',    path: '/api/investigation-vaccination-contexts',                 minRole: 'USER',       code: 'ESAVI-INVVACTX-002A' },
    { method: 'get',    path: '/api/investigation-vaccination-contexts/admin',           minRole: 'ADMIN',      code: 'ESAVI-INVVACTX-002B' },
    { method: 'delete', path: `/api/investigation-vaccination-contexts/purge/${ UUID }`, minRole: 'SUPERADMIN', code: 'ESAVI-INVVACTX-005C' },
    { method: 'get',    path: `/api/investigation-vaccination-contexts/case/${ UUID }`,  minRole: 'USER',       code: 'ESAVI-INVVACTX-006' },
    { method: 'get',    path: `/api/investigation-vaccination-contexts/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-INVVACTX-003' },
    { method: 'put',    path: `/api/investigation-vaccination-contexts/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-INVVACTX-004' },

    // investigationVaccineAdministered (SPEC F37) - the seventh satellite of investigation with a
    // spec of its own, and the SECOND of them that is a COLLECTION and not a one to one: the vaccines
    // the investigation records as administered, with their dose number. NINE operations, and the
    // first satellite of investigation since F31 to carry a complete 005A and 005B: this table does
    // have an isActive column, so it has state of its own to withdraw and give back.
    // The listing is DUAL and entered by the parent, never by /: 002A on /investigation/:id for USER
    // returns only the live rows, 002B on /admin/investigation/:id for ADMIN returns them all. The
    // :id of the other operations is the vaccineAdministeredId, because the row has a key of its own.
    // Its 006 enters by the caseId and walks case -> investigation -> vaccines, returning
    // { count, rows } because the last hop is one to many.
    // TWO ROWS DEVIATE from the canonical matrix, the same deviation as F05, F06, F07, F09, F10,
    // F13, F14 and F28 to F36: 001 and 004 on USER, because the administered vaccine is captured in
    // the same operational flow as the case.
    // Nothing here is encrypted: a foreign key to a dictionary, an integer and a note, with no
    // person's name among them, so no row raises its minimum for that reason
    { method: 'post',   path: '/api/investigation-vaccines-administered',                             minRole: 'USER',       code: 'ESAVI-INVVACAD-001' },
    { method: 'get',    path: `/api/investigation-vaccines-administered/admin/investigation/${ UUID }`, minRole: 'ADMIN',      code: 'ESAVI-INVVACAD-002B' },
    { method: 'get',    path: `/api/investigation-vaccines-administered/investigation/${ UUID }`,     minRole: 'USER',       code: 'ESAVI-INVVACAD-002A' },
    { method: 'get',    path: `/api/investigation-vaccines-administered/case/${ UUID }`,              minRole: 'USER',       code: 'ESAVI-INVVACAD-006' },
    { method: 'delete', path: `/api/investigation-vaccines-administered/purge/${ UUID }`,             minRole: 'SUPERADMIN', code: 'ESAVI-INVVACAD-005C' },
    { method: 'patch',  path: `/api/investigation-vaccines-administered/activate/${ UUID }`,          minRole: 'ADMIN',      code: 'ESAVI-INVVACAD-005B' },
    { method: 'get',    path: `/api/investigation-vaccines-administered/${ UUID }`,                   minRole: 'USER',       code: 'ESAVI-INVVACAD-003' },
    { method: 'put',    path: `/api/investigation-vaccines-administered/${ UUID }`,                   minRole: 'USER',       code: 'ESAVI-INVVACAD-004' },
    { method: 'delete', path: `/api/investigation-vaccines-administered/${ UUID }`,                   minRole: 'ADMIN',      code: 'ESAVI-INVVACAD-005A' },

    // investigationColdChain (SPEC F38) - the eighth satellite of investigation with a spec of its
    // own, and the seventh with the exact shape of F36: the primary key IS the foreign key, so the
    // :id of every operation is the investigationId and the 003 is already the access by
    // investigation. How the investigated vaccine was kept and how it travelled.
    // SEVEN operations and NO 005A nor 005B: the table has no isActive column, so it has no state of
    // its own to withdraw or give back - retiring a cold chain is retiring its investigation. The
    // listing is DUAL because the visibility is inherited from investigation.isActive, and its 006
    // enters by the caseId and walks case -> investigation -> cold chain, returning the object and
    // not { count, rows } because both hops are one to one.
    // TWO ROWS DEVIATE from the canonical matrix, the same deviation as F05, F06, F07, F09, F10,
    // F13, F14 and F28 to F37: 001 and 004 on USER, because the cold chain is captured in the same
    // operational flow as the case.
    // Nothing here is encrypted: ten answers, four free texts and a note, with no person's name
    // among them, so no row raises its minimum for that reason
    { method: 'post',   path: '/api/investigation-cold-chains',                 minRole: 'USER',       code: 'ESAVI-INVCOLD-001' },
    { method: 'get',    path: '/api/investigation-cold-chains',                 minRole: 'USER',       code: 'ESAVI-INVCOLD-002A' },
    { method: 'get',    path: '/api/investigation-cold-chains/admin',           minRole: 'ADMIN',      code: 'ESAVI-INVCOLD-002B' },
    { method: 'delete', path: `/api/investigation-cold-chains/purge/${ UUID }`, minRole: 'SUPERADMIN', code: 'ESAVI-INVCOLD-005C' },
    { method: 'get',    path: `/api/investigation-cold-chains/case/${ UUID }`,  minRole: 'USER',       code: 'ESAVI-INVCOLD-006' },
    { method: 'get',    path: `/api/investigation-cold-chains/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-INVCOLD-003' },
    { method: 'put',    path: `/api/investigation-cold-chains/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-INVCOLD-004' },

    // investigationAdministrationError (SPEC F39) — what went wrong in the act of administering the
    // vaccine: which syringes it was applied with, how the vial was reconstituted and the six
    // concrete errors. Ninth satellite of investigation with a spec of its own, and the same seven
    // operations as its sister investigationColdChain: no 005A and no 005B, because the table has no
    // isActive column and does not manage its own state — its investigation does.
    // 001 and 004 stay in USER, the deviation of F05 to F38: the detail is captured in the same
    // operational flow as the case.
    // Nothing here is encrypted: sixteen answers and ten free texts, with no person's name among
    // them, so no row raises its minimum for that reason
    { method: 'post',   path: '/api/investigation-administration-errors',                 minRole: 'USER',       code: 'ESAVI-INVADMER-001' },
    { method: 'get',    path: '/api/investigation-administration-errors',                 minRole: 'USER',       code: 'ESAVI-INVADMER-002A' },
    { method: 'get',    path: '/api/investigation-administration-errors/admin',           minRole: 'ADMIN',      code: 'ESAVI-INVADMER-002B' },
    { method: 'delete', path: `/api/investigation-administration-errors/purge/${ UUID }`, minRole: 'SUPERADMIN', code: 'ESAVI-INVADMER-005C' },
    { method: 'get',    path: `/api/investigation-administration-errors/case/${ UUID }`,  minRole: 'USER',       code: 'ESAVI-INVADMER-006' },
    { method: 'get',    path: `/api/investigation-administration-errors/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-INVADMER-003' },
    { method: 'put',    path: `/api/investigation-administration-errors/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-INVADMER-004' },

    // investigationCommunity (SPEC F40) — where the patient lives and whether the community reported
    // other similar events. Tenth satellite of investigation with a spec of its own, and the same
    // seven operations as its sisters investigationColdChain and investigationAdministrationError:
    // no 005A and no 005B, because the table has no isActive column and does not manage its own
    // state — its investigation does.
    // 001 and 004 stay in USER, the deviation of F05 to F39: the detail is captured in the same
    // operational flow as the case.
    // NOTHING HERE IS ENCRYPTED EITHER, but this is the first satellite that holds THE HOME
    // COORDINATES OF THE PATIENT — and they still do not raise the minimum of any row. The reason is
    // declared in SPEC F40 §6 and §7: esaviCrypt yields text and the columns are numeric(10,7), so
    // encrypting them would mean changing the DDL. The exposure is a risk left open, not a role
    // decision, and hiding the reads behind ADMIN would break the operational flow without making
    // the stored value any safer
    { method: 'post',   path: '/api/investigation-communities',                 minRole: 'USER',       code: 'ESAVI-INVCOMM-001' },
    { method: 'get',    path: '/api/investigation-communities',                 minRole: 'USER',       code: 'ESAVI-INVCOMM-002A' },
    { method: 'get',    path: '/api/investigation-communities/admin',           minRole: 'ADMIN',      code: 'ESAVI-INVCOMM-002B' },
    { method: 'delete', path: `/api/investigation-communities/purge/${ UUID }`, minRole: 'SUPERADMIN', code: 'ESAVI-INVCOMM-005C' },
    { method: 'get',    path: `/api/investigation-communities/case/${ UUID }`,  minRole: 'USER',       code: 'ESAVI-INVCOMM-006' },
    { method: 'get',    path: `/api/investigation-communities/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-INVCOMM-003' },
    { method: 'put',    path: `/api/investigation-communities/${ UUID }`,       minRole: 'USER',       code: 'ESAVI-INVCOMM-004' },

    // finalClassification (SPEC F41) — the causality verdict of the WHO/PAHO algorithm, and the
    // fifth and last satellite of esaviCase to get a spec. NINE ROWS, and it is the first entity
    // since F26 with 005A and 005B: the table has an isActive column of its own (esaviapp.sql:1275),
    // unlike the ten satellites of investigation of F29 to F40. Its twin in shape is classification
    // (SPEC F09): own primary key, UNIQUE ("caseId"), and a 006 that is NOT redundant with the 003
    // because the :id here is the finalClassificationId and the client has never seen it.
    // 001 and 004 in USER, the same deviation from the canonical matrix as F05 to F40: the verdict
    // is captured in the same operational flow as the case. 005C exists because finalClassification
    // is outside the preventPhysicalDelete loop of esaviapp.sql:1372-1386
    { method: 'post',   path: '/api/final-classifications',                     minRole: 'USER',       code: 'ESAVI-FINCLASS-001' },
    { method: 'get',    path: '/api/final-classifications',                     minRole: 'USER',       code: 'ESAVI-FINCLASS-002A' },
    { method: 'get',    path: '/api/final-classifications/admin',               minRole: 'ADMIN',      code: 'ESAVI-FINCLASS-002B' },
    { method: 'patch',  path: `/api/final-classifications/activate/${ UUID }`,  minRole: 'SUPERADMIN', code: 'ESAVI-FINCLASS-005B' },
    { method: 'delete', path: `/api/final-classifications/purge/${ UUID }`,     minRole: 'SUPERADMIN', code: 'ESAVI-FINCLASS-005C' },
    { method: 'get',    path: `/api/final-classifications/case/${ UUID }`,      minRole: 'USER',       code: 'ESAVI-FINCLASS-006' },
    { method: 'get',    path: `/api/final-classifications/${ UUID }`,           minRole: 'USER',       code: 'ESAVI-FINCLASS-003' },
    { method: 'put',    path: `/api/final-classifications/${ UUID }`,           minRole: 'USER',       code: 'ESAVI-FINCLASS-004' },
    { method: 'delete', path: `/api/final-classifications/${ UUID }`,           minRole: 'ADMIN',      code: 'ESAVI-FINCLASS-005A' },

    // systemConfig (SPEC F26) — the store of the application behaviour parameters, and the first
    // entity of the auth-and-system block. Seven canonical operations plus three non-canonical ones:
    // 006 reads by the (code, scope) pair, because whoever reads configuration knows the name of the
    // parameter and not its UUID; 007 lists the change history of systemConfigHistory, which has no
    // route of its own and is always entered through the parent; and 008 seeds the initial
    // configurations idempotently.
    // FOUR ROWS DEVIATE FROM THE CANONICAL ROLE MATRIX, demanding SUPERADMIN where the norm puts
    // ADMIN: 001, 004, 005A and 005B. A parameter of this table governs the behaviour of the whole
    // application for all of its users, and isEncrypted declares that some of them may be a secret.
    // The deviation is declared in SPEC F26 §2, §3.4 and §6 — it is deliberate, not an oversight, and
    // it is not generalized: ADMIN stays the default write role everywhere else.
    // No 005C: systemConfig and systemConfigHistory both sit inside the preventPhysicalDelete loop of
    // esaviapp.sql:1361-1375, so physical deletion is not declared
    { method: 'post',   path: '/api/system-configs',                                     minRole: 'SUPERADMIN', code: 'ESAVI-SYSCONF-001' },
    { method: 'get',    path: '/api/system-configs',                                     minRole: 'USER',       code: 'ESAVI-SYSCONF-002A' },
    { method: 'get',    path: '/api/system-configs/admin',                               minRole: 'ADMIN',      code: 'ESAVI-SYSCONF-002B' },
    { method: 'get',    path: '/api/system-configs/code/ESAVI_APP_DEFAULT_LIMIT',        minRole: 'USER',       code: 'ESAVI-SYSCONF-006' },
    { method: 'post',   path: '/api/system-configs/sync',                                minRole: 'SUPERADMIN', code: 'ESAVI-SYSCONF-008' },
    { method: 'patch',  path: `/api/system-configs/activate/${ UUID }`,                  minRole: 'SUPERADMIN', code: 'ESAVI-SYSCONF-005B' },
    { method: 'get',    path: `/api/system-configs/${ UUID }/history`,                   minRole: 'SUPERADMIN', code: 'ESAVI-SYSCONF-007' },
    { method: 'get',    path: `/api/system-configs/${ UUID }`,                           minRole: 'USER',       code: 'ESAVI-SYSCONF-003' },
    { method: 'put',    path: `/api/system-configs/${ UUID }`,                           minRole: 'SUPERADMIN', code: 'ESAVI-SYSCONF-004' },
    { method: 'delete', path: `/api/system-configs/${ UUID }`,                           minRole: 'SUPERADMIN', code: 'ESAVI-SYSCONF-005A' }
];

/**
 * The role one step below the given one, by numeric level. Returns undefined
 * for ANALYTICS, which is the floor and has nothing below it.
 */
const roleBelow = ( role: TestRole ): TestRole | undefined => {
    const target = ROLE_LEVELS[ROLES[role]];

    const lower = (Object.keys(ROLES) as TestRole[])
        .filter(candidate => ROLE_LEVELS[ROLES[candidate]] < target)
        .sort((a, b) => ROLE_LEVELS[ROLES[b]] - ROLE_LEVELS[ROLES[a]]);

    return lower[0];
};

describe('role matrix', () => {

    // These tests probe authorization with throwaway ids, so the handlers they
    // reach log the resulting 404s and 500s. That output is expected here.
    let consoleError: jest.SpyInstance;

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe.each(ROUTE_RULES)('$code — $method $path', ({ method, path, minRole }) => {

        const below = roleBelow(minRole);

        it(`rejects ${ below } with 403`, async () => {
            const response = await request(app)[method](path).set(authHeader(below as TestRole));

            expect(response.status).toBe(403);
        });

        it(`does not reject ${ minRole } with 403`, async () => {
            const response = await request(app)[method](path).set(authHeader(minRole));

            expect(response.status).not.toBe(403);
        });

    });

    describe('the matrix itself', () => {

        it('covers every route that declares validateUserRole', () => {
            // Bumped deliberately when a route is added, so a new endpoint cannot
            // slip in without a rule in ROUTE_RULES.
            expect(ROUTE_RULES).toHaveLength(311);
        });

        it('has a role below every minimum it uses, so the 403 side is always testable', () => {
            for( const rule of ROUTE_RULES ) {
                expect(roleBelow(rule.minRole)).toBeDefined();
            }
        });

    });

    describe('unauthenticated routes', () => {

        it('GET /api/health needs no token', async () => {
            const response = await request(app).get('/api/health');

            expect(response.status).toBe(200);
        });

        it('POST /api/auth/login needs no token', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({ email: 'nobody@test.local', password: 'wrong-password' });

            // Reaches the handler: bad credentials, not a missing token
            expect([400, 401]).toContain(response.status);
            expect(response.body.message).not.toBe(undefined);
        });

    });

});
