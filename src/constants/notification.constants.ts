// The two Postgres ENUM types that notification uses, declared once here and imported by the
// model and by the validator. Repeating the literals in either place would let the two lists
// diverge the moment someone adds a value to only one of them.
// Both mirror esaviapp.sql exactly, values and order included:
//   notificationType -> esaviapp.sql:31
//   answerOption     -> esaviapp.sql:26
// Adding a value is a schema migration, and it must touch this file in the same commit.
export const NOTIFICATION_TYPES = ['SEVERE', 'NON_SEVERE'] as const;

// answerOption is shared by six more tables of the schema, all of them out of scope today.
// When the first of them is specified, this constant moves to a shared file — it is not copied.
export const ANSWER_OPTIONS = ['YES', 'NO', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER'] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type AnswerOption = (typeof ANSWER_OPTIONS)[number];
