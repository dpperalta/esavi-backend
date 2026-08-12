// Postgres ENUM types shared by more than one entity, declared once here and imported by every
// model and validator that needs them. Repeating the literals anywhere else would let the lists
// diverge the moment someone adds a value to only one of them.
// Adding a value is a schema migration, and it must touch this file in the same commit.

// answerOption -> esaviapp.sql:26. Shared by notification, severeNotification and five more
// tables of the schema. Values and order mirror the DDL exactly.
export const ANSWER_OPTIONS = ['YES', 'NO', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER'] as const;

export type AnswerOption = (typeof ANSWER_OPTIONS)[number];
