import { Model, ModelStatic } from 'sequelize';
import { AppError } from './appError.helper';
import { getMessage } from './i18n.helper';

// The guard every satellite table of notification needs before a physical deletion, and the only
// safety net those tables have: they carry no isActive column, so the isActive check inside
// purgeEntityService is inert on them — `undefined !== true` lets every row through, and a 005C
// would destroy a row nobody ever retired.
//
// It lives here and not inside purgeEntityService on purpose. Adding an optional predicate to the
// common service would touch a file that notifier, classification, appUserGeoLocation and
// notification already depend on, to solve something a helper solves without touching it. And it
// is a helper and not a copy per service because there are eight satellites coming: with the
// second one already here, eight copies of the same condition is the thing being avoided.
//
// Only the AppError code is passed in. The i18n key and the id are derived from the row itself:
// the block of messages of an entity is named exactly like its table — true for the twenty
// entities of the repository — and the id is whatever the model declares as primary key, which on
// every satellite is the shared notificationId. Deriving them keeps the third satellite from
// having to register anything anywhere.
export const assertRowIsSealed = (row: Model, code: string, lang: string): void => {
    // The translation of "physical deletion only reaches what somebody retired before, in a
    // deliberate and reversible way" to the only seal these tables have. Retiring one of these
    // details is retiring its header, so a sealed deletedAt is what proves the two deliberate
    // steps happened
    if( row.get('deletedAt') ) return;

    const model = row.constructor as ModelStatic<Model>;
    const id = row.get(model.primaryKeyAttribute) as string;

    throw new AppError(
        getMessage(`${ model.getTableName() }.notDeleted`, lang, { id }),
        409,
        code
    );
}
