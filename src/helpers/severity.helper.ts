// The severity coherence matrix, as a single pure predicate. It lives here and not inside the
// validator because the two callers evaluate it over different inputs: the create validator
// passes the body, the update service passes the stored row merged with the body. Two
// implementations of the same rule drift apart, and the rule is the business logic of the entity
export type SeverityViolation =
    'SERIOUS_FLAG_REQUIRED'
    | 'SERIOUS_WITHOUT_CRITERION'
    | 'OTHER_CONDITION_WITHOUT_DESCRIPTION';

export interface SeverityState {
    isSeriousEvent?: boolean | null;
    causedDeath?: boolean | null;
    causedDisability?: boolean | null;
    causedCongenitalAnomaly?: boolean | null;
    causedFetalDeath?: boolean | null;
    causedLifeThreatening?: boolean | null;
    causedHospitalization?: boolean | null;
    causedAbortion?: boolean | null;
    causedOtherCondition?: boolean | null;
    otherSeriousConditionDescription?: string | null;
}

// The eight criteria that make an event serious, plus causedOtherCondition, which is the ninth
export const SERIOUS_CRITERION_FIELDS = [
    'causedDeath',
    'causedDisability',
    'causedCongenitalAnomaly',
    'causedFetalDeath',
    'causedLifeThreatening',
    'causedHospitalization',
    'causedAbortion',
    'causedOtherCondition'
] as const;

// Has Any Serious Criterion
// Strict comparison against true: null and undefined are "not informed", which is not "no",
// and neither of them makes an event serious
const hasAnySeriousCriterion = (state: SeverityState): boolean =>
    SERIOUS_CRITERION_FIELDS.some((field) => state[field] === true);

// Find Severity Violation
// Returns the first rule the state breaks, or null when it is coherent. The fourth row of the
// matrix — at least one criterion in true derives isSeriousEvent to true — is not a violation
// and is applied by the service, so it does not appear here
const findSeverityViolation = (state: SeverityState): SeverityViolation | null => {
    if( state.causedOtherCondition === true && !String(state.otherSeriousConditionDescription ?? '').trim() ) {
        return 'OTHER_CONDITION_WITHOUT_DESCRIPTION';
    }
    if( !hasAnySeriousCriterion(state) ) {
        // Without any criterion behind it, the flag has to be stated: an empty record would
        // otherwise be stored as a valid classification and the case would count as classified
        if( state.isSeriousEvent === undefined || state.isSeriousEvent === null ) {
            return 'SERIOUS_FLAG_REQUIRED';
        }
        // A serious classification with no cause is not information, it is a ticked box
        if( state.isSeriousEvent === true ) {
            return 'SERIOUS_WITHOUT_CRITERION';
        }
    }
    return null;
}

// The message each violation carries. They are English literals and not i18n keys because the
// validator answers through validateFields, which speaks the express-validator contract
export const SEVERITY_VIOLATION_MESSAGES: Record<SeverityViolation, string> = {
    SERIOUS_FLAG_REQUIRED: 'Is Serious Event is required when no severity criterion is set to true',
    SERIOUS_WITHOUT_CRITERION: 'Is Serious Event cannot be true without at least one severity criterion',
    OTHER_CONDITION_WITHOUT_DESCRIPTION: 'Other Serious Condition Description is required when Caused Other Condition is true'
};

export {
    hasAnySeriousCriterion,
    findSeverityViolation
}
