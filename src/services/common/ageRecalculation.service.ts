import { Transaction } from 'sequelize';
import { CatalogItem, CatalogType, Classification, EsaviCase, Patient } from '../../models';
import { AppError, getMessage, resolveAgeAtEvent } from '../../helpers';
import { AppDetails, AuthUser } from '../../types';

// Code of the catalogType that groups the three age units, the same one classification.service.ts
// resolves against: the age recalculated here has to mean exactly what the age computed there means
const AGE_UNIT_CATALOG_CODE = 'ageUnit';

// The three codes the calculation can resolve to. Fixed and few, which is what allows the catalog
// to be read once per invocation instead of once per row
const AGE_UNIT_CODES = ['YEARS', 'MONTHS', 'DAYS'];

// Every case of a patient, or the single classification of one case. The two shapes are exclusive
// on purpose: a scope that carried both would leave which one wins undefined
type RecalculationScope = { patientId: string } | { caseId: string };

// The operation that triggered the recalculation. It travels because it is what the audit entry
// and the AppError codes are built from: the classification did not change on its own, someone
// corrected a date somewhere else
type RecalculationOp = 'ESAVI-PATIENT-004' | 'ESAVI-CASE-004';

const ERROR_ENTITY: Record<RecalculationOp, string> = {
    'ESAVI-PATIENT-004': 'PATIENT',
    'ESAVI-CASE-004': 'CASE'
};

const CAUSE_DETAIL: Record<RecalculationOp, string> = {
    'ESAVI-PATIENT-004': "Age recalculated after its patient's birthDate changed",
    'ESAVI-CASE-004': "Age recalculated after its case's eventDate changed"
};

// The three units in one query, indexed by code. A missing item does not fail here: it fails on
// the first row that needs that particular unit, which is what keeps the error about the row
const findAgeUnitItemsByCode = async (transaction: Transaction): Promise<Map<string, string>> => {
    const items = await CatalogItem.findAll({
        where: { code: AGE_UNIT_CODES, isActive: true },
        attributes: ['catalogItemId', 'code'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: AGE_UNIT_CATALOG_CODE },
            attributes: []
        }],
        transaction
    });
    return new Map(items.map((item) => [item.code, item.catalogItemId]));
}

// The classifications in scope, always read from Classification and never from the patient: there
// is no Patient.hasMany(EsaviCase) — a deliberate omission of SPEC F06 — and this spec does not
// add it. The case include does NOT filter by isActive: a deactivated case with an active
// classification is reachable through ESAVI-CLASSIF-005B, and in that state the classification is
// still live data
const findClassificationsInScope = async (scope: RecalculationScope, transaction: Transaction): Promise<Classification[]> => {
    const caseInclude = {
        model: EsaviCase,
        as: 'case',
        attributes: ['caseId', 'eventDate'],
        include: [{
            model: Patient,
            as: 'patient',
            attributes: ['patientId', 'birthDate']
        }]
    };

    if( 'caseId' in scope ) {
        // At most one row: UQ_classification_case allows no more per case
        const classification = await Classification.findOne({
            where: { caseId: scope.caseId, isActive: true },
            include: [caseInclude],
            transaction
        });
        return classification ? [classification] : [];
    }

    return await Classification.findAll({
        where: { isActive: true },
        include: [{ ...caseInclude, required: true, where: { patientId: scope.patientId } }],
        transaction
    });
}

// Recalculate Classification Ages Service
// Triggered by ESAVI-PATIENT-004 and ESAVI-CASE-004
//
// classification.age and classification.ageUnitItemId are derived from patient.birthDate and
// esaviCase.eventDate, so correcting either of those two dates leaves the stored age contradicting
// its own origin — silently, which is the worst failure mode for a surveillance system. This is the
// only place where that propagation lives: the two triggers do the same thing with a different
// scope, and duplicating it would guarantee that in a year they do different things.
//
// It runs inside the caller's transaction, AFTER the patient or the case has been written, so its
// reads already see the new values and nothing has to be passed in by parameter. If it throws, the
// caller's rollback undoes that write too: storing a birthDate that leaves a classification in an
// impossible state is exactly the incoherent data this is here to prevent.
//
// Row by row and not one mass UPDATE like the ESAVI-CASE-005A cascade: there every row got the same
// value, here each classification is measured against the eventDate of ITS own case, so there is no
// common SET. That is why the return value is a count and not a boolean.
//
// It does not go through updateClassificationService: that one expects a body, evaluates the
// severity matrix and writes method 'ESAVI-CLASSIF-004' — it would lie in the audit trail and drag
// in rules that do not apply here. No other column of the classification is touched, and the
// severity matrix is never re-evaluated: this operation receives no body and cannot alter any caused*
const recalculateClassificationAgesService = async (
    scope: RecalculationScope,
    op: RecalculationOp,
    authUser: AuthUser | undefined,
    lang: string,
    transaction: Transaction
): Promise<number> => {
    const classifications = await findClassificationsInScope(scope, transaction);
    if( classifications.length === 0 ) {
        return 0;
    }

    const entity = ERROR_ENTITY[op];
    const ageUnitItems = await findAgeUnitItemsByCode(transaction);
    let changed = 0;

    for( const classification of classifications ) {
        const esaviCase = classification.case;

        let calculated;
        try {
            calculated = resolveAgeAtEvent(esaviCase?.patient?.birthDate, esaviCase?.eventDate);
        } catch {
            // The conflict is between two rows that already exist, so it is a 409, the same status
            // SPEC F09 chose for this same cause: one error cannot have two statuses depending on
            // which door it came through. The AppError code carries the entity and the operation,
            // which is what tells the operator where it was triggered from
            throw new AppError(
                getMessage('classification.invalidAgeRange', lang),
                409,
                `${ entity }_004_AGE_RECALC_INVALID_RANGE`
            );
        }

        // One of the two dates is gone. The row is left alone: the age is not recalculated and it
        // is not nulled either. Nulling it would destroy the last known value for a coherence the
        // next edit would restore anyway, and informing the date again recalculates
        if( !calculated ) {
            continue;
        }

        const ageUnitItemId = ageUnitItems.get(calculated.unitCode);
        if( !ageUnitItemId ) {
            // A missing item is a deployment precondition that was not met, not a client mistake.
            // Loud on purpose: tolerating it here would store an age whose unit means nothing
            throw new AppError(
                getMessage('classification.ageUnitCatalogMissing', lang, { code: calculated.unitCode }),
                404,
                `${ entity }_004_AGE_RECALC_CATALOG_MISSING`
            );
        }

        // Nothing to register: no UPDATE, no updatedAt and no audit entry. An appDetails entry
        // saying 'recalculated' when nothing changed turns the history into noise and hides the
        // times it really did change
        if( classification.age === calculated.age && classification.ageUnitItemId === ageUnitItemId ) {
            continue;
        }

        const currentAppDetails = Array.isArray(classification.appDetails) ? classification.appDetails : [];
        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: authUser?.userId || 'undefined',
            method: op,
            detail: CAUSE_DETAIL[op]
        };
        await classification.update({
            age: calculated.age,
            ageUnitItemId,
            // Explicit because there is no trigger writing it
            updatedAt: new Date(),
            appDetails: [
                ...currentAppDetails,
                newEntry
            ]
        }, { transaction });
        changed++;
    }

    return changed;
}

export {
    recalculateClassificationAgesService
}
