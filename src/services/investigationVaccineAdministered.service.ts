import { InferAttributes, Op, Transaction } from 'sequelize';
import { sequelize } from '../database/connection';
import { Investigation, InvestigationVaccineAdministered, VaccineWhodrug } from '../models';
import { AppError, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateInvestigationVaccineAdministeredInput } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// There is no CREATE_FIELDS here, and that is a decision and not an omission. In the eight sister
// tables of the setSortOrderByParent loop the column is NOT NULL, so Sequelize runs its own notNull
// validation before emitting the INSERT and the create dies without the trigger ever running; the
// explicit field list was the only way out. In this table sortOrder is nullable and carries no
// DEFAULT 0 (esaviapp.sql:1160), the validation does not fire, the INSERT carries "sortOrder" = NULL
// and setSortOrderByParent reads that as "assign it yourself". It is the shape F35 found, and the
// create is the ordinary one: the service simply does not send the key

// The columns every response carries, listed one by one instead of dropped afterwards. sysDetails is
// trigger bookkeeping and never leaves the service, and an explicit list is what keeps it out without
// having to mention it.
//
// vaccineWhodrugId travels here as a raw FK *and* resolved in the include below, which is the pattern
// of F16, F21 and F22: the 004 accepts it in the body, so a PUT that resends the response of its GET
// has to find it there
const RESPONSE_ATTRIBUTES: (keyof InferAttributes<InvestigationVaccineAdministered>)[] = [
    'vaccineAdministeredId',
    'investigationId',
    'sortOrder',
    'vaccineWhodrugId',
    'doseNumber',
    'notes',
    'isActive',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'appDetails'
];

// The parent, read on every operation to implement the inherited visibility. A single hop, unlike
// the two of F35: this table hangs straight off investigation, and the state lives in that one link.
//
// It never reaches the response: whoever needs the investigation enters through ESAVI-INVESTGN-003
const INVESTIGATION_INCLUDE = {
    model: Investigation,
    as: 'investigation',
    attributes: ['investigationId', 'isActive'],
    required: true
};

// Three fields of the master and none of the other twenty six columns. An entry retired from the
// dictionary after the record still says what was administered, so the include NEVER filters by
// isActive; whoever needs the whole entry enters through ESAVI-WHODRUG-003. It is the decision of
// F22 §3.7, inherited literally.
//
// required: false on purpose. In practice every row created through this API has its FK resolved -
// the 001 demands it and the 004 cannot empty it - but a row loaded by direct SQL may not, and an
// INNER JOIN would make it vanish from the listing without a trace
const WHODRUG_INCLUDE = {
    model: VaccineWhodrug,
    as: 'vaccineWhodrug',
    attributes: ['vaccineWhodrugId', 'drugCode', 'drugName'],
    required: false
};

// The parent is dropped here after having done its job in the query, and the master comes back as an
// explicit null when its key has no value, so a client does not have to tell "empty" from "absent".
//
// doseNumber is returned as the number it is: a 0 is never collapsed into a null, because "dose
// zero" and "the dose is unknown" are different data
const toInvestigationVaccineAdministeredResponse = (vaccine: InvestigationVaccineAdministered) => {
    const plain = vaccine.toJSON() as Record<string, unknown>;
    delete plain.investigation;

    plain.vaccineWhodrug = plain.vaccineWhodrug ?? null;

    return plain;
}

// The free text is normalized on write with trim, and a text that is blank after trimming is no text
// at all. There is no code column to constant case nor a name to title case.
//
// This is yet another copy of this helper in the repository. Extracting it is overdue since F24 §7
// and has its own spec pending
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// The parent guard of 001, 002A, 002B and 006. A single query over investigation by primary key that
// fails with 404 if the investigation does not exist or is inactive.
//
// The two causes share code and message: telling them apart is of no use to the investigator, since
// in both the missing link is one level up and the corrective action is the same one.
//
// canViewInactive relaxes the isActive check and only in the readings. In the 001 nothing is relaxed,
// SUPERADMIN included: a retired investigation takes no new vaccines from anyone
const findValidInvestigation = async (
    investigationId: string,
    op: string,
    lang: string,
    canViewInactive: boolean = false,
    transaction?: Transaction
) => {
    const investigation = await Investigation.findOne({
        where: canViewInactive ? { investigationId } : { investigationId, isActive: true },
        attributes: ['investigationId'],
        transaction
    });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationVaccineAdministered.investigationNotFound', lang),
            404,
            `INVVACAD_${ op }_INVESTIGATION_NOT_FOUND`
        );
    }
    return investigation;
}

// The master must exist and be ACTIVE. Two causes - it does not exist, it is inactive - and a single
// error, with the shape F22 §3.5 gave it.
//
// A findOne over the table itself is enough: vaccineWhodrug hangs off no catalogType, so the double
// hop F14, F21, F35 and F36 needed does not apply here.
//
// It runs BEFORE the diff and with independence of it: an inactive entry is a 404 even if it matches
// what is stored. And it only runs when the key ends up with a value
const assertWhodrugIsValid = async (
    vaccineWhodrugId: string,
    op: string,
    lang: string,
    transaction?: Transaction
) => {
    const whodrug = await VaccineWhodrug.findOne({
        where: { vaccineWhodrugId, isActive: true },
        attributes: ['vaccineWhodrugId'],
        transaction
    });
    if( !whodrug ) {
        throw new AppError(
            getMessage('investigationVaccineAdministered.whodrugNotFound', lang),
            404,
            `INVVACAD_${ op }_WHODRUG_NOT_FOUND`
        );
    }
    return whodrug;
}

// The uniqueness of the triple (investigationId, vaccineWhodrugId, doseNumber), compared against the
// ACTIVE rows of the same investigation. A row retired by a 005A does not block the create of the
// same vaccine: the live list is the one that has to stay coherent.
//
// doseNumber enters the comparison WITH ITS NULL INCLUDED: two rows of the same vaccine with no dose
// number are the same row twice. In Sequelize that is a plain { doseNumber: null } in the where,
// which generates IS NULL and not = NULL - writing it with Op.eq over a null would never find the
// collision and the duplicate would walk in.
//
// Called from three operations and not two: 001, 004 and 005B. The 005B is the third door a
// duplicate can enter the live list through, because it returns a row whose triple may have been
// taken while it was retired
const assertNoDuplicateVaccine = async (
    investigationId: string,
    vaccineWhodrugId: string | null,
    doseNumber: number | null,
    op: string,
    lang: string,
    transaction?: Transaction,
    excludeId?: string
) => {
    const where: Record<string, unknown> = {
        investigationId,
        vaccineWhodrugId,
        doseNumber,
        isActive: true
    };
    if( excludeId ) {
        where.vaccineAdministeredId = { [Op.ne]: excludeId };
    }

    const duplicate = await InvestigationVaccineAdministered.findOne({
        where,
        attributes: ['vaccineAdministeredId'],
        transaction
    });
    if( duplicate ) {
        throw new AppError(
            getMessage('investigationVaccineAdministered.alreadyExists', lang, {
                doseNumber: doseNumber === null ? '' : String(doseNumber)
            }),
            409,
            `INVVACAD_${ op }_ALREADY_EXISTS`
        );
    }
}

// The read that shapes the response of 001, 003 and 004. The parent travels with required: true and
// its isActive checked, which is what implements the inherited visibility in the same query the
// instance comes out of
const findVaccineAdministeredWithRelations = async (
    vaccineAdministeredId: string,
    includeInactive: boolean,
    transaction?: Transaction
) => {
    return InvestigationVaccineAdministered.findOne({
        where: includeInactive
            ? { vaccineAdministeredId }
            : { vaccineAdministeredId, isActive: true },
        attributes: RESPONSE_ATTRIBUTES,
        include: [
            WHODRUG_INCLUDE,
            {
                ...INVESTIGATION_INCLUDE,
                where: includeInactive ? {} : { isActive: true }
            }
        ],
        transaction
    });
}

// Create Investigation Vaccine Administered Service
// Code: ESAVI-INVVACAD-001
// Everything inside a single transaction, so the parent guard, the master validation and the
// duplicate guard see the same snapshot the INSERT lands on
const createInvestigationVaccineAdministeredService = async (
    data: CreateInvestigationVaccineAdministeredInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    const transaction = await sequelize.transaction();
    let createdId: string;

    try {
        // Nothing relaxed here, not even for SUPERADMIN: a retired investigation takes no new
        // vaccines whoever asks. It is the criterion of F31, F33 and F35 for their 001
        await findValidInvestigation(data.investigationId, '001', lang, false, transaction);

        // The presence of vaccineWhodrugId is the validator's job and the service does not repeat
        // it: in the create the body IS the complete resulting state
        await assertWhodrugIsValid(data.vaccineWhodrugId, '001', lang, transaction);

        // Normalization first, so what the duplicate guard looks at is what is going to be stored
        const doseNumber = data.doseNumber ?? null;
        const notes = normalizeText(data.notes);

        await assertNoDuplicateVaccine(
            data.investigationId,
            data.vaccineWhodrugId,
            doseNumber,
            '001',
            lang,
            transaction
        );

        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-INVVACAD-001',
            detail: 'Investigation vaccine administered created by service'
        };

        // sortOrder is deliberately absent from the create, and here that is enough on its own: the
        // column is nullable, so Sequelize emits "sortOrder" = NULL and
        // TRG_investigationVaccineAdministered_setSortOrder assigns it under the advisory lock that
        // keeps two concurrent inserts from colliding. No fields list is needed
        const created = await InvestigationVaccineAdministered.create({
            investigationId: data.investigationId,
            vaccineWhodrugId: data.vaccineWhodrugId,
            doseNumber,
            notes,
            appDetails: [newEntry]
        }, { transaction });

        createdId = created.vaccineAdministeredId;

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    // Re-read so the response carries the master and the sortOrder the trigger assigned, neither of
    // which the create instance knows
    const vaccine = await findVaccineAdministeredWithRelations(createdId, true);
    return vaccine ? toInvestigationVaccineAdministeredResponse(vaccine) : null;
}

// Get Active Investigation Vaccines Administered By Investigation Service
// Code: ESAVI-INVVACAD-002A
// The listing is entered by the foreign key and never by /: an administered vaccine does not exist
// without its investigation, and a global listing has no reader. Unlike the five one to one
// satellites, the 003 cannot double as the listing here: the row has a key of its own, so the access
// by row and the access by investigation are different things.
//
// Ordered by sortOrder ascending, which is the whole point of the column, and with no filter by
// vaccineWhodrugId, doseNumber or text over notes — those are out of the scope of this spec.
//
// A visible investigation with no vaccines answers 200 with { count: 0, rows: [] }, and only an
// investigation that fails the guard answers 404
const getInvestigationVaccinesAdministeredByInvestigationService = async (
    investigationId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await findValidInvestigation(investigationId, '002A', lang, canViewInactive);

    const vaccines = await InvestigationVaccineAdministered.findAndCountAll({
        where: { investigationId, isActive: true },
        attributes: RESPONSE_ATTRIBUTES,
        include: [WHODRUG_INCLUDE],
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });

    return {
        count: vaccines.count,
        rows: vaccines.rows.map(toInvestigationVaccineAdministeredResponse)
    };
}

// Get All Investigation Vaccines Administered By Investigation Service
// Code: ESAVI-INVVACAD-002B
// Identical to the 002A but for the where, which does not filter by isActive: this one returns the
// retired rows and the ones with a sealed deletedAt too. It is the operation that justifies the new
// index of §3.1 — the only index covering investigationId today is the partial unique one, which
// excludes precisely the rows this listing does return
const getAllInvestigationVaccinesAdministeredByInvestigationService = async (
    investigationId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await findValidInvestigation(investigationId, '002B', lang, canViewInactive);

    const vaccines = await InvestigationVaccineAdministered.findAndCountAll({
        where: { investigationId },
        attributes: RESPONSE_ATTRIBUTES,
        include: [WHODRUG_INCLUDE],
        order: [['sortOrder', 'ASC']],
        paranoid: false,
        limit,
        offset
    });

    return {
        count: vaccines.count,
        rows: vaccines.rows.map(toInvestigationVaccineAdministeredResponse)
    };
}

export {
    createInvestigationVaccineAdministeredService,
    getInvestigationVaccinesAdministeredByInvestigationService,
    getAllInvestigationVaccinesAdministeredByInvestigationService
}
