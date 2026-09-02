import { cast, col, CreationAttributes, fn, literal, Op, Transaction, WhereOptions } from 'sequelize';
import { sequelize } from '../database/connection';
import { VaccineWhodrug } from '../models';
import { AppError, buildDifferentialUpdate, buildTextSearchConditions, esaviLog, getMessage, parseWhodrugXlsxFile, WhodrugFileError } from '../helpers';
import {
    AppDetails,
    AuthUser,
    CreateVaccineWhodrugInput,
    ImportVaccineWhodrugsInput,
    ParsedVaccineWhodrugRow,
    VaccineWhodrugImportReport,
    VaccineWhodrugListFilters,
    VaccineWhodrugTreeAncestor,
    VaccineWhodrugTreeFilters,
    VaccineWhodrugTreeLevel,
    VaccineWhodrugTreeOption,
    VaccineWhodrugTreeResult
} from '../types';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The real file is around 3000 rows, which is three batches. The size is the one the .asc importer
// already uses: the batch is the unit of the transaction, so it is also the unit of what survives a
// failure halfway through, and the dictionary will grow
const IMPORT_BATCH_SIZE = 1000;

// The counters stay exact; only the sample of rejected rows is trimmed
const MAX_REPORTED_IMPORT_ERRORS = 20;

// The 23 nullable text columns of the entity, trimmed on write and never normalized any further.
// undefined and null both land as null on create: an absent field and an explicitly emptied one
// mean the same thing when the row does not exist yet
const trimOrNull = (value?: string | null): string | null =>
    value !== undefined && value !== null ? value.trim() : null;

// sysDetails is internal trigger state and never leaves the service. The reads drop it through
// `attributes: { exclude }`, which a create cannot use, so the returned instance is flattened and
// stripped here — the response shape of §3.7 is the 36 columns minus this one
const stripSysDetails = (vaccineWhodrug: VaccineWhodrug): Record<string, unknown> => {
    const plain = vaccineWhodrug.get({ plain: true }) as Record<string, unknown>;
    delete plain.sysDetails;
    return plain;
}

// Shared by both listings, which take exactly the same seven filters. name and code are the
// canonical parameters (SPEC F52): name is an Op.iLike over drugName, code over drugCode, joined
// with Op.or — the autocomplete of the notification form needs prefixes and fragments, which is
// why the GIN index IX_vaccineWhodrug_name is deliberately left unconsumed. search is the legacy
// alias and feeds both columns at once. The two booleans are compared against undefined and never
// by truthiness, or ?isPreferred=false would silently return everything
const buildVaccineWhodrugWhere = (filters: VaccineWhodrugListFilters): WhereOptions => {
    const where: Record<string, unknown> = {};
    const textConditions = [
        ...buildTextSearchConditions(filters.name ?? filters.search, ['drugName']),
        ...buildTextSearchConditions(filters.code ?? filters.search, ['drugCode'])
    ];
    if (textConditions.length > 0) {
        where[Op.or as unknown as string] = textConditions;
    }
    if (filters.language) {
        where.language = filters.language.trim();
    }
    if (filters.iso3Code) {
        where.iso3Code = filters.iso3Code.trim();
    }
    if (filters.isPreferred !== undefined) {
        where.isPreferred = filters.isPreferred;
    }
    // There is no way to ask for isGeneric IS NULL: it would need a sentinel value in the query and
    // it is out of this spec's scope
    if (filters.isGeneric !== undefined) {
        where.isGeneric = filters.isGeneric;
    }
    return where;
}

// ESAVI-WHODRUG-001 - Create Vaccine Whodrug Service
const createVaccineWhodrugService = async (data: CreateVaccineWhodrugInput, authUser: AuthUser | undefined, lang: string) => {
    // externalId is the only unique column of the table, and it is checked only when the body
    // brings it non-null: under a Postgres UNIQUE, N rows with NULL coexist, so an entry without it
    // never collides. The check does not filter by isActive — an inactive row still occupies the
    // key and the constraint still fires
    const externalId = data.externalId ?? null;
    if (externalId !== null) {
        const existingVaccine = await VaccineWhodrug.findOne({
            where: { externalId },
            attributes: ['vaccineWhodrugId']
        });
        if (existingVaccine) {
            throw new AppError(getMessage('vaccineWhodrug.externalIdExists', lang, { externalId }), 409, 'WHODRUG_001_EXTERNAL_ID_EXISTS');
        }
    }
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-WHODRUG-001',
        detail: 'Vaccine WHODrug created by service'
    };
    const newVaccineWhodrug = await VaccineWhodrug.create({
        externalId,
        // Only trimmed, never toConstantCase: a dictionary code is quoted data, and rewriting it
        // would break the correspondence with the source file, which is the whole point of the
        // code. Interior spaces stay as they came — '003649 01 001' is one code, not three
        drugCode: data.drugCode.trim(),
        // Only trimmed, never toTitleCase: toTitleCase would turn 'BCG vaccine' into 'Bcg Vaccine'
        // and destroy the acronyms, which in a vaccine dictionary are half of the names
        drugName: data.drugName.trim(),
        drugRecNo: trimOrNull(data.drugRecNo),
        drugRecNoSeq: trimOrNull(data.drugRecNoSeq),
        language: trimOrNull(data.language),
        medicinalProductId: trimOrNull(data.medicinalProductId),
        atcs: trimOrNull(data.atcs),
        icd11: trimOrNull(data.icd11),
        icd11Term: trimOrNull(data.icd11Term),
        abbreviation: trimOrNull(data.abbreviation),
        ingredient: trimOrNull(data.ingredient),
        ingredientTranslation: trimOrNull(data.ingredientTranslation),
        languageCode: trimOrNull(data.languageCode),
        iso3Code: trimOrNull(data.iso3Code),
        countryMedicinalProductId: trimOrNull(data.countryMedicinalProductId),
        maHolders: trimOrNull(data.maHolders),
        maHoldersMedicinalProductId: trimOrNull(data.maHoldersMedicinalProductId),
        form: trimOrNull(data.form),
        formTranslations: trimOrNull(data.formTranslations),
        formMedicinalProductId: trimOrNull(data.formMedicinalProductId),
        strength: trimOrNull(data.strength),
        strengthMedicinalProductId: trimOrNull(data.strengthMedicinalProductId),
        noDose: trimOrNull(data.noDose),
        diluent: trimOrNull(data.diluent),
        // Three states: an absent isGeneric stays null — 'unknown' — instead of collapsing to false
        isGeneric: data.isGeneric ?? null,
        // NOT NULL in the DDL: the comparison is against undefined, never a truthiness test, or an
        // explicit false would be silently turned into the default
        isPreferred: data.isPreferred !== undefined ? data.isPreferred : false,
        notes: trimOrNull(data.notes),
        isActive: data.isActive !== undefined ? data.isActive : true,
        appDetails: [newEntry]
    });
    return stripSysDetails(newVaccineWhodrug);
}

// ESAVI-WHODRUG-002A - Get Active Vaccine Whodrugs Service
const getActiveVaccineWhodrugsService = async (filters: VaccineWhodrugListFilters, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const vaccineWhodrugs = await VaccineWhodrug.findAndCountAll({
        where: {
            ...buildVaccineWhodrugWhere(filters),
            isActive: true
        },
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        order: [['drugName', 'ASC']],
        limit,
        offset
    });
    return vaccineWhodrugs;
}

// ESAVI-WHODRUG-002B - Get All Vaccine Whodrugs Service (including inactive) - For Admin
const getAllVaccineWhodrugsService = async (filters: VaccineWhodrugListFilters, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    // The twin of 002A without isActive in the where, and with no filter of its own: unlike
    // diagnosticTerm, this entity has no review queue to look into
    const vaccineWhodrugs = await VaccineWhodrug.findAndCountAll({
        where: buildVaccineWhodrugWhere(filters),
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        order: [['drugName', 'ASC']],
        limit,
        offset
    });
    return vaccineWhodrugs;
}

// ESAVI-WHODRUG-003 - Get Vaccine Whodrug by ID Service
const getVaccineWhodrugByIdService = async (id: string, lang: string, includeInactive: boolean = false) => {
    const whereClause = includeInactive ? { vaccineWhodrugId: id } : { vaccineWhodrugId: id, isActive: true };
    // No includes: the entity has no associations at all, so there is nothing to join
    const vaccineWhodrug = await VaccineWhodrug.findOne({
        where: whereClause,
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] }
    });
    if (!vaccineWhodrug) {
        throw new AppError(getMessage('vaccineWhodrug.notFound', lang), 404, 'WHODRUG_003_NOT_FOUND');
    }
    return vaccineWhodrug;
}

// How every nullable text column enters `candidates`: null empties the column and undefined means
// the key never travelled, which are two different intents. The comparison is against undefined
// and never a truthiness test, or an empty string would be silently dropped
const textCandidate = (value?: string | null): string | null | undefined =>
    value !== undefined ? (value?.trim() ?? null) : undefined;

// ESAVI-WHODRUG-004 - Update Vaccine Whodrug Service
const updateVaccineWhodrugService = async (id: string, data: Partial<CreateVaccineWhodrugInput>, authUser: AuthUser | undefined, lang: string) => {
    const { userId } = authUser || {};
    const vaccineWhodrug = await VaccineWhodrug.findByPk(id);
    if (!vaccineWhodrug) {
        throw new AppError(getMessage('vaccineWhodrug.notFound', lang), 404, 'WHODRUG_004_NOT_FOUND');
    }
    let updatedVaccineWhodrug = vaccineWhodrug;
    // Uniqueness runs before the diff and independently of it: an occupied externalId is a 409 even
    // when the rest of the body changes nothing. It only runs when the body brings it non-null —
    // emptying the column can never collide — and excluding the own id is what lets a client resend
    // its own value without colliding with itself. drugCode is not checked: it has no uniqueness
    const targetExternalId = data.externalId !== undefined ? (data.externalId ?? null) : undefined;
    if (targetExternalId !== undefined && targetExternalId !== null) {
        const existingVaccine = await VaccineWhodrug.findOne({
            where: {
                externalId: targetExternalId,
                vaccineWhodrugId: { [Op.ne]: id }
            },
            attributes: ['vaccineWhodrugId']
        });
        if (existingVaccine) {
            throw new AppError(getMessage('vaccineWhodrug.externalIdExists', lang, { externalId: targetExternalId }), 409, 'WHODRUG_004_EXTERNAL_ID_EXISTS');
        }
    }
    const currentAppDetails = Array.isArray(vaccineWhodrug.appDetails) ? vaccineWhodrug.appDetails : [];
    // `stored` is the whole row, which is the precondition of the helper: a narrowed `attributes`
    // would read back undefined for the columns it left out and every comparison would count as a
    // change. The 28 data columns are candidates and nothing else — isActive is governed by 005A
    // and 005B, and the provenance column only ever by the bulk import of SPEC F19
    const stored = vaccineWhodrug.get({ plain: true }) as Record<string, unknown>;
    const objectToUpdate = buildDifferentialUpdate(stored, {
        // Mutable and with nothing to check: a typo in a manually entered code has to be fixable,
        // and the column no longer constrains anything. Only trimmed, as in the create
        drugCode: data.drugCode ? data.drugCode.trim() : undefined,
        drugName: data.drugName ? data.drugName.trim() : undefined,
        externalId: targetExternalId,
        drugRecNo: textCandidate(data.drugRecNo),
        drugRecNoSeq: textCandidate(data.drugRecNoSeq),
        language: textCandidate(data.language),
        medicinalProductId: textCandidate(data.medicinalProductId),
        atcs: textCandidate(data.atcs),
        icd11: textCandidate(data.icd11),
        icd11Term: textCandidate(data.icd11Term),
        abbreviation: textCandidate(data.abbreviation),
        ingredient: textCandidate(data.ingredient),
        ingredientTranslation: textCandidate(data.ingredientTranslation),
        languageCode: textCandidate(data.languageCode),
        iso3Code: textCandidate(data.iso3Code),
        countryMedicinalProductId: textCandidate(data.countryMedicinalProductId),
        maHolders: textCandidate(data.maHolders),
        maHoldersMedicinalProductId: textCandidate(data.maHoldersMedicinalProductId),
        form: textCandidate(data.form),
        formTranslations: textCandidate(data.formTranslations),
        formMedicinalProductId: textCandidate(data.formMedicinalProductId),
        strength: textCandidate(data.strength),
        strengthMedicinalProductId: textCandidate(data.strengthMedicinalProductId),
        noDose: textCandidate(data.noDose),
        diluent: textCandidate(data.diluent),
        // Nullable boolean: false and null are different values, so a PUT with isGeneric: null
        // empties the column and a PUT with isGeneric: false writes false over a stored null
        isGeneric: data.isGeneric !== undefined ? (data.isGeneric ?? null) : undefined,
        // NOT NULL in the DDL, so never null. Never `if( data.isPreferred )` either: that would
        // discard an explicit false and the flag could never be unset
        isPreferred: data.isPreferred !== undefined ? data.isPreferred : undefined,
        notes: textCandidate(data.notes)
    });
    // Nothing changed: no UPDATE, no updatedAt, no appDetails entry and no sysDetails event
    if (Object.keys(objectToUpdate).length > 0) {
        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: userId || 'undefined',
            method: 'ESAVI-WHODRUG-004',
            detail: 'Vaccine WHODrug updated by service'
        };
        updatedVaccineWhodrug = await vaccineWhodrug.update({
            ...objectToUpdate,
            updatedAt: new Date(),
            appDetails: [
                ...currentAppDetails,
                newEntry
            ]
        }, { returning: true });
    }
    return stripSysDetails(updatedVaccineWhodrug);
}

// ESAVI-WHODRUG-005A / ESAVI-WHODRUG-005B - Set Vaccine Whodrug Activation Service
// Not a differential update: these are writes with an intention of their own. They record a state
// fact, so they go through setEntityActiveStatusService and never through buildDifferentialUpdate.
// The where filters by the primary key alone: no incoming foreign key is checked, because this is a
// logical delete — the ON DELETE RESTRICT constraints of the two child tables never fire, an
// inactive vaccine keeps being referenced by design, and neither table exists yet. Deactivating
// means "stop offering it in the autocomplete", not "stop existing"
const setVaccineWhodrugActivationService = async (id: string, authUser: AuthUser | undefined, lang: string, isActive: boolean = true) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        const vaccineWhodrug = await setEntityActiveStatusService({
            model: VaccineWhodrug,
            where: { vaccineWhodrugId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('vaccineWhodrug.notFound', lang),
            notFoundCode: `WHODRUG_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`vaccineWhodrug.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `WHODRUG_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                // Only the computed operation code, with no _ACTIVATION stuck behind it
                method: `ESAVI-WHODRUG-${ op }`,
                detail: `VaccineWhodrug ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return vaccineWhodrug;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// ESAVI-WHODRUG-007 - Import Vaccine Whodrugs Service
const importVaccineWhodrugsService = async (
    fileBuffer: Buffer | undefined,
    data: ImportVaccineWhodrugsInput,
    authUser: AuthUser | undefined,
    lang: string
): Promise<VaccineWhodrugImportReport> => {
    // Phase 1 — reception. The controller already checks it, and so does this service: it is the
    // only precondition whose absence would reach the parser as a crash instead of as a 400
    if (!fileBuffer) {
        throw new AppError(getMessage('vaccineWhodrug.fileRequired', lang), 400, 'WHODRUG_007_FILE_REQUIRED');
    }
    const dictionaryVersion = data.dictionaryVersion ? data.dictionaryVersion.trim() : undefined;
    const dryRun = data.dryRun ?? false;
    const userId = authUser?.userId || 'undefined';

    // Phase 2 — parsing. A rejected row never aborts the process; it is counted and the file goes on
    let parsedFile;
    try {
        parsedFile = await parseWhodrugXlsxFile(fileBuffer);
    } catch (error) {
        // Only a book that cannot be opened or carries no sheet arrives here as a 400. Anything else
        // the parser may throw is a defect and stays a 500, so it never disguises itself as a bad file
        if (error instanceof WhodrugFileError) {
            throw new AppError(getMessage('vaccineWhodrug.fileInvalid', lang), 400, 'WHODRUG_007_FILE_INVALID', error);
        }
        throw error;
    }
    const { sheet, rows, rejected, missingOptionalHeaders, unknownHeaders, missingRequiredHeaders } = parsedFile;

    // A missing required header cuts before a single data row was read, and therefore before
    // anything could be written. The list of what is missing travels in the AppError
    if (missingRequiredHeaders.length > 0) {
        esaviLog(`ESAVI-WHODRUG-007 - Required headers missing from the uploaded file: ${ missingRequiredHeaders.join(', ') }`, 'warn');
        throw new AppError(
            getMessage('vaccineWhodrug.fileInvalid', lang),
            400,
            'WHODRUG_007_FILE_INVALID',
            new Error(`Missing required headers: ${ missingRequiredHeaders.join(', ') }`)
        );
    }
    // Fully empty rows are neither read nor invalid, so every counted row ended in one of the two lists
    const read = rows.length + rejected.length;
    const duplicated = rejected.filter(row => row.reason === 'DUPLICATE_IN_FILE').length;
    const invalid = rejected.length - duplicated;
    // The other content problem that cuts the operation, and it also cuts before writing: a book with
    // the right header and not one usable row
    if (rows.length === 0) {
        throw new AppError(
            getMessage('vaccineWhodrug.fileInvalid', lang),
            400,
            'WHODRUG_007_FILE_INVALID',
            new Error('The file produced no valid row')
        );
    }

    const importedAt = new Date();
    // The same for every inserted row, so it is built once. There is no reviewStatus, unlike the .asc
    // importer: vaccineWhodrug has no implicit resolution and therefore no review queue to feed.
    // dictionaryVersion is omitted rather than stored as null when it did not travel in the body
    const importMetadata: Record<string, unknown> = {
        importedFrom: 'WHODRUG',
        importedAt,
        ...(dictionaryVersion ? { dictionaryVersion } : {}),
        autoCreated: false
    };
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    // Phase 3 — one batch at a time. Reading the existing rows and computing the diff happens the
    // same way in both modes; `transaction` is undefined on a dry run, where nothing is written
    const processBatch = async (batch: ParsedVaccineWhodrugRow[], transaction?: Transaction): Promise<void> => {
        // The whole row, with no narrowed `attributes` and no isActive filter: it is the precondition
        // of buildDifferentialUpdate, and an inactive row still occupies the externalId
        const existingVaccines = await VaccineWhodrug.findAll({
            where: { externalId: { [Op.in]: batch.map(row => row.externalId) } },
            transaction
        });
        const existingByExternalId = new Map(existingVaccines.map(vaccine => [vaccine.externalId as number, vaccine]));
        const vaccinesToInsert: CreationAttributes<VaccineWhodrug>[] = [];

        for (const row of batch) {
            const storedVaccine = existingByExternalId.get(row.externalId);
            if (!storedVaccine) {
                // Phase 4 — insertion. notes is not written: the file does not bring it and the column
                // stays null. isActive is always true — the .xlsx declares no currency, so inferring
                // one from the file would be inventing it
                vaccinesToInsert.push({
                    externalId: row.externalId,
                    drugCode: row.drugCode,
                    drugName: row.drugName,
                    ...row.values,
                    isActive: true,
                    deletedAt: null,
                    metadata: importMetadata,
                    appDetails: [{
                        createdAt: new Date(),
                        user: userId,
                        method: 'ESAVI-WHODRUG-007',
                        detail: 'Vaccine WHODrug created by bulk import service'
                    }]
                } as CreationAttributes<VaccineWhodrug>);
                continue;
            }
            const stored = storedVaccine.get({ plain: true }) as Record<string, unknown>;
            // The 26 columns the file is the complete source of, each one entering with no presence
            // check: there is no client body to ask, and it is the helper that decides whether there
            // is an UPDATE. Neither boolean is guarded by truthiness, or a false would be dropped in
            // silence and the flag could never be cleared by import.
            // externalId stays out — the row was found *by* it. notes stays out — the file does not
            // bring it, and a note written by the 004 must survive a reimport. isActive and deletedAt
            // stay out — the file declares no currency. metadata stays out: rewriting it would erase
            // the importedAt and the dictionaryVersion the row first came in with
            const objectToUpdate = buildDifferentialUpdate(stored, {
                drugCode: row.drugCode,
                drugName: row.drugName,
                drugRecNo: row.values.drugRecNo,
                drugRecNoSeq: row.values.drugRecNoSeq,
                language: row.values.language,
                medicinalProductId: row.values.medicinalProductId,
                atcs: row.values.atcs,
                icd11: row.values.icd11,
                icd11Term: row.values.icd11Term,
                abbreviation: row.values.abbreviation,
                ingredient: row.values.ingredient,
                ingredientTranslation: row.values.ingredientTranslation,
                languageCode: row.values.languageCode,
                iso3Code: row.values.iso3Code,
                countryMedicinalProductId: row.values.countryMedicinalProductId,
                maHolders: row.values.maHolders,
                maHoldersMedicinalProductId: row.values.maHoldersMedicinalProductId,
                form: row.values.form,
                formTranslations: row.values.formTranslations,
                formMedicinalProductId: row.values.formMedicinalProductId,
                strength: row.values.strength,
                strengthMedicinalProductId: row.values.strengthMedicinalProductId,
                noDose: row.values.noDose,
                diluent: row.values.diluent,
                isGeneric: row.values.isGeneric,
                isPreferred: row.values.isPreferred
            });
            // Nothing changed: no UPDATE, no updatedAt, no appDetails entry and no sysDetails event
            if (Object.keys(objectToUpdate).length === 0) {
                unchanged++;
                continue;
            }
            updated++;
            if (!dryRun) {
                const currentAppDetails = Array.isArray(storedVaccine.appDetails) ? storedVaccine.appDetails : [];
                const newEntry: AppDetails = {
                    createdAt: new Date(),
                    user: userId,
                    method: 'ESAVI-WHODRUG-007',
                    detail: 'Vaccine WHODrug updated by bulk import service'
                };
                await storedVaccine.update({
                    ...objectToUpdate,
                    updatedAt: new Date(),
                    appDetails: [
                        ...currentAppDetails,
                        newEntry
                    ]
                }, { transaction });
            }
        }

        if (vaccinesToInsert.length > 0) {
            inserted += vaccinesToInsert.length;
            // No updateOnDuplicate and no ignoreDuplicates: the previous SELECT already told apart
            // what is new, and updateOnDuplicate would overwrite appDetails and metadata of the
            // existing rows and write even when nothing changed
            if (!dryRun) {
                await VaccineWhodrug.bulkCreate(vaccinesToInsert, { transaction });
            }
        }
    }

    for (let index = 0; index < rows.length; index += IMPORT_BATCH_SIZE) {
        const batch = rows.slice(index, index + IMPORT_BATCH_SIZE);
        // A dry run opens no transaction at all: there is nothing to roll back
        if (dryRun) {
            await processBatch(batch);
            continue;
        }
        // One transaction per batch instead of one for the whole file: a failure leaves the previous
        // ones committed and the report says how far it got, and reimporting is idempotent
        const transaction = await sequelize.transaction();
        try {
            await processBatch(batch, transaction);
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            // No retry: a unique constraint violation here means two simultaneous imports, which with
            // a SUPERADMIN role is an operation error and is better made visible
            esaviLog(`ESAVI-WHODRUG-007 - Batch starting at row ${ batch[0].row } failed and was rolled back`, 'error');
            throw new AppError(getMessage('vaccineWhodrug.importedFailed', lang), 500, 'WHODRUG_007_IMPORT_FAILED', error);
        }
    }

    // Phase 5 — report. errors is trimmed to the first 20 entries; the counters are the real totals.
    // The two header lists travel in the response and not only in the log: an export that renames a
    // column does not fail, it silently leaves that column null in every row
    return {
        read,
        inserted,
        updated,
        unchanged,
        invalid,
        duplicated,
        dryRun,
        sheet,
        missingOptionalHeaders,
        unknownHeaders,
        errors: rejected.slice(0, MAX_REPORTED_IMPORT_ERRORS)
    };
}

// ---------------------------------------------------------------------------------------------
// SPEC F54 — hierarchical navigation of the WHODrug tree, ESAVI-WHODRUG-006A..006E
// ---------------------------------------------------------------------------------------------

// The ancestors of every level, in hierarchy order. The level name is also the column it groups by
// and the query parameter that carries it downwards; the fourth level groups formTranslations, the
// translated form the user reads, and never form
const TREE_ANCESTORS: Record<VaccineWhodrugTreeLevel, VaccineWhodrugTreeAncestor[]> = {
    abbreviation: [],
    drugName: ['abbreviation'],
    maHolders: ['abbreviation', 'drugName'],
    formTranslations: ['abbreviation', 'drugName', 'maHolders'],
    strength: ['abbreviation', 'drugName', 'maHolders', 'formTranslations']
};

// What an ancestor carries when the option it came from had value null. Four of the five columns of
// the tree are nullable, and without this the rows behind a null option would be unreachable by
// navigation. '__NULL__' does not occur in the WHODrug dictionary, which is why it can be reserved
const TREE_NULL_SENTINEL = '__NULL__';

// The subset every level shares, replicated from the external backend with the language made
// configurable: rows of the requested country, plus the generic preferred ones of the language.
// Three things it does not do, all of them deliberate:
//   - it never interpolates the query string into SQL — the external backend does, on all five
//     parameters, and that is five injection points open to any authenticated user
//   - country absent removes its branch instead of comparing against an empty string
//   - isActive is always true, with no admin variant: navigation exists to pick a vaccine in a
//     form, and a row that was taken down must not be selectable
const buildTreeSubsetConditions = (filters: VaccineWhodrugTreeFilters, lang: string): WhereOptions[] => {
    const language = filters.language ?? lang;
    const subsetBranches: WhereOptions[] = [];
    if (filters.country) {
        subsetBranches.push({ iso3Code: filters.country.trim() });
    }
    subsetBranches.push({ iso3Code: null, language, isPreferred: true });
    // The whole OR stays inside its own condition. Flattened, the generic branch would swallow the
    // ancestor filters and every level would answer with the entire dictionary
    return [{ isActive: true }, { [Op.or]: subsetBranches }];
}

// One query per level. The external backend spends three — a COUNT of distinct values, a COUNT of
// rows and the SELECT — over the same subset; count and total are derived here from the options
// already in memory
const getTreeLevelOptions = async (
    level: VaccineWhodrugTreeLevel,
    filters: VaccineWhodrugTreeFilters,
    lang: string
): Promise<VaccineWhodrugTreeResult> => {
    const conditions = buildTreeSubsetConditions(filters, lang);
    for (const ancestor of TREE_ANCESTORS[level]) {
        const value = filters[ancestor];
        if (value === undefined) {
            continue;
        }
        // Exact equality, never iLike and never normalized: the value comes from the previous
        // level's own response, so it matches character by character
        conditions.push(value === TREE_NULL_SENTINEL
            ? { [Op.or]: [{ [ancestor]: null }, { [ancestor]: '' }] }
            : { [ancestor]: value });
    }
    // The search filters the same column that is grouped, so it discards whole groups and never
    // single rows inside one: that is what keeps matchCount meaning "rows hanging from this
    // option". A search over any other column would silently break the uniqueness signal
    const textConditions = buildTextSearchConditions(filters.search, [level]);
    if (textConditions.length > 0) {
        conditions.push({ [Op.or]: textConditions });
    }

    // The import can leave an empty string where the file had a blank cell. Without the NULLIF that
    // string would be an option of its own, indistinguishable on screen from the null one and with
    // the counters split between the two
    const valueExpression = fn('NULLIF', col(level), '');
    const rows = await VaccineWhodrug.findAll({
        attributes: [
            [valueExpression, 'value'],
            // Cast to integer on purpose: Postgres returns COUNT as bigint and the driver hands it
            // over as a string, which would ship "matchCount": "3" and break the === 1 of the client
            [cast(fn('COUNT', col('vaccineWhodrugId')), 'integer'), 'matchCount'],
            // The id is resolved in this same query. With one row in the group the MIN is that row;
            // with more than one the expression is NULL and there is no id to give. No user input
            // reaches this literal
            [literal('CASE WHEN COUNT("vaccineWhodrugId") = 1 THEN MIN("vaccineWhodrugId"::text) END'), 'vaccineWhodrugId']
        ],
        where: { [Op.and]: conditions },
        group: [valueExpression],
        // Ascending. In Postgres an ASC order already puts the nulls last, so the option with no
        // value closes the list instead of opening it
        order: [[valueExpression, 'ASC']],
        raw: true
    }) as unknown as VaccineWhodrugTreeOption[];

    const options = rows.map((row) => ({
        value: row.value,
        matchCount: row.matchCount,
        vaccineWhodrugId: row.vaccineWhodrugId ?? null
    }));
    return {
        count: options.length,
        total: options.reduce((sum, option) => sum + option.matchCount, 0),
        options
    };
}

// The five services stay separate even though they all delegate here: each one carries its own
// operation code into its esaviLog and its AppError, which is what the five-point rule of the
// operation code requires. A single service parameterized by level would collapse them into one

// ESAVI-WHODRUG-006A - Get WHODrug Abbreviations Service
const getWhodrugAbbreviationsService = async (filters: VaccineWhodrugTreeFilters, lang: string) =>
    getTreeLevelOptions('abbreviation', filters, lang);

// ESAVI-WHODRUG-006B - Get WHODrug Drug Names Service
const getWhodrugDrugNamesService = async (filters: VaccineWhodrugTreeFilters, lang: string) =>
    getTreeLevelOptions('drugName', filters, lang);

// ESAVI-WHODRUG-006C - Get WHODrug MA Holders Service
const getWhodrugMaHoldersService = async (filters: VaccineWhodrugTreeFilters, lang: string) =>
    getTreeLevelOptions('maHolders', filters, lang);

// ESAVI-WHODRUG-006D - Get WHODrug Forms Service
const getWhodrugFormsService = async (filters: VaccineWhodrugTreeFilters, lang: string) =>
    getTreeLevelOptions('formTranslations', filters, lang);

// ESAVI-WHODRUG-006E - Get WHODrug Strengths Service
const getWhodrugStrengthsService = async (filters: VaccineWhodrugTreeFilters, lang: string) =>
    getTreeLevelOptions('strength', filters, lang);

export {
    createVaccineWhodrugService,
    getActiveVaccineWhodrugsService,
    getAllVaccineWhodrugsService,
    getVaccineWhodrugByIdService,
    updateVaccineWhodrugService,
    setVaccineWhodrugActivationService,
    importVaccineWhodrugsService,
    getWhodrugAbbreviationsService,
    getWhodrugDrugNamesService,
    getWhodrugMaHoldersService,
    getWhodrugFormsService,
    getWhodrugStrengthsService
};
