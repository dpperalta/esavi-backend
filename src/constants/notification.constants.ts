// The Postgres ENUM type that only notification uses, declared once here and imported by the
// model and by the validator. Repeating the literals in either place would let the two lists
// diverge the moment someone adds a value to only one of them.
// It mirrors esaviapp.sql exactly, values and order included:
//   notificationType -> esaviapp.sql:31
// Adding a value is a schema migration, and it must touch this file in the same commit.
export const NOTIFICATION_TYPES = ['SEVERE', 'NON_SEVERE'] as const;

// answerOption used to live here. It is shared by seven tables of the schema, so it moved to
// src/constants/enums.constants.ts when severeNotification became its second consumer. Import
// ANSWER_OPTIONS and AnswerOption from there — do not redeclare them here.

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// Naegele's rule with a +/- 14 day tolerance: 38 to 42 weeks between the last menstruation date and
// the probable delivery date. notificationPregnancy rejects any pair of dates outside that window,
// both bounds inclusive. They live here, named, because they are clinical values someone will want to
// adjust, and grepping the service for 294 is worse than reading them from this file.
export const GESTATION_MIN_DAYS = 266;
export const GESTATION_MAX_DAYS = 294;

// The systemConfig row that holds the catalogItemId of the female sex, read by ESAVI-NOTIFPRG-001 to
// reject a pregnancy registered on a patient whose sex is recorded as something else. The value is a
// UUID that changes per installation, so it is seeded by ESAVI-SYSCONF-001 on every deployment and
// deliberately absent from src/data/systemConfig.defaults.ts. Both constants are already in the
// constant-case form systemConfig stores after its own toConstantCase, so the service normalizes nothing.
export const PREGNANCY_FEMALE_SEX_ITEM_CONFIG_CODE = 'PREGNANCY_FEMALE_SEX_ITEM';
export const PREGNANCY_FEMALE_SEX_ITEM_CONFIG_SCOPE = 'GLOBAL';
