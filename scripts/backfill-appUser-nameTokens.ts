// Backfill for SPEC F62 §3.8: populates "nameTokens" on rows written before this spec landed.
// Idempotent — filters by nameTokens = '{}' and, re-run on an already populated row, produces
// the same array. Not a differential update: it does not touch updatedAt, does not append to
// appDetails and does not emit a sysDetails event, because nobody edited the user — the column
// is being backfilled onto data that already existed (SPEC F62 §3.6, §6).
//
// Run with: NODE_ENV=development npx ts-node scripts/backfill-appUser-nameTokens.ts
import { Op } from 'sequelize';
import { initModels, AppUser } from '../src/models';
import { connectDatabase } from '../src/database/connection';
import { esaviCrypt, esaviDecrypt, toNameTokens } from '../src/helpers';

const PAGE_SIZE = 100;

// R3: if ESAVI_CRYPT_KEY rotated since the rows were written, esaviDecrypt returns garbage and
// the script would mint tokens nobody can ever match — a silent failure, since the backfill
// itself finishes without error. A decrypted name is expected to be printable text; anything
// else aborts before a single row is written
const looksLikePlainText = (value: string): boolean => /^[\p{L}\p{M}\s'.-]+$/u.test(value);

const backfillNameTokens = async (): Promise<void> => {
    initModels();
    await connectDatabase();

    let processed = 0;
    let checkedDecryption = false;
    // Keyset pagination on userId, not offset: rows with neither firstName nor lastName stay
    // matched by `nameTokens = '{}'` forever because nothing updates them, so an offset-less
    // re-query from the top would loop on them without end. Advancing past the last userId seen
    // makes every row visited exactly once, updated or not
    let lastUserId: string | null = null;

    for (;;) {
        const rows: AppUser[] = await AppUser.findAll({
            where: {
                nameTokens: { [Op.eq]: [] },
                ...(lastUserId ? { userId: { [Op.gt]: lastUserId } } : {})
            },
            limit: PAGE_SIZE,
            order: [['userId', 'ASC']]
        });

        if (rows.length === 0) {
            break;
        }

        for (const row of rows) {
            const decryptedFirstName = row.firstName ? esaviDecrypt(row.firstName) : '';
            const decryptedLastName = row.lastName ? esaviDecrypt(row.lastName) : '';

            if (!checkedDecryption && (decryptedFirstName || decryptedLastName)) {
                const sample = decryptedFirstName || decryptedLastName;
                if (!looksLikePlainText(sample)) {
                    throw new Error(
                        `Aborting: decrypted name "${sample}" does not look like plain text. ` +
                        'ESAVI_CRYPT_KEY may not match the key that encrypted this row (SPEC F62 R3).'
                    );
                }
                checkedDecryption = true;
            }

            // Rows without firstName nor lastName mint no tokens and stay reachable only by
            // email or username (SPEC F62 §3.8) — nameTokens keeps its default '{}'
            const tokens = toNameTokens(decryptedFirstName, decryptedLastName).map(esaviCrypt);
            if (tokens.length > 0) {
                await row.update({ nameTokens: tokens });
            }
            processed += 1;
            lastUserId = row.userId;
        }

        if (rows.length < PAGE_SIZE) {
            break;
        }
    }

    console.log(`Backfill complete. Rows scanned: ${processed}.`);
    process.exit(0);
};

backfillNameTokens().catch((error) => {
    console.error(error);
    process.exit(1);
});
