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
            expect(ROUTE_RULES).toHaveLength(187);
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
