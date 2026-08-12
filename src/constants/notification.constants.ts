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
