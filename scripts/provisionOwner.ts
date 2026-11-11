/**
 * Provisions, or in an emergency recovers, the owner account out of band (FC 044 T1.1a, T1.1b;
 * logic in apps/api/src/services/ownerProvision.ts). No HTTP route grants the role `owner`: this
 * script, run by the operator against the database, is the only way.
 *
 * Environment: the API's own settings (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME,
 * AUTH_SECRET, TOTP_ENCRYPTION_KEY), plus OWNER_EMAIL and, optionally, OWNER_FULL_NAME (default
 * GrayMan). The e-mail is given only here, at run time: it is never written in the repository
 * (T2.3). The account receives the 15-minute reset link of FC 042 by mail; the running API sends
 * it on its next outbox sweep.
 *
 * It prints one outcome code and nothing about the account: no address, id, token nor hash.
 *
 * CLI: `bun scripts/provisionOwner.ts` (first provision)
 *   or `bun scripts/provisionOwner.ts --recover` (same as OWNER_RECOVER=1: the owner lost the
 *   authenticator and the 8 backup codes)
 * exit 0 = OWNER_PROVISIONED or OWNER_RECOVERY_DISPATCHED · exit 1 = refused, nothing changed.
 */
import { loadConfig } from '../apps/api/src/config';
import { createDb } from '../apps/api/src/services/db';
import {
  type OwnerOutcome,
  provisionOwner,
  readOwnerRequest,
  recoverOwner,
} from '../apps/api/src/services/ownerProvision';

/** Outcomes that changed the database as asked. */
const DONE: readonly OwnerOutcome[] = [
  'OWNER_PROVISIONED',
  'OWNER_RECOVERY_DISPATCHED',
];

/** Gate E: the request and the API settings, or null when either is missing or malformed. */
function readEnvironment() {
  const request = readOwnerRequest(process.env, process.argv.slice(2));
  try {
    const { db, auth } = loadConfig(process.env);
    return request === null || auth === null ? null : { request, db, auth };
  } catch {
    // The reason may quote a setting: the code alone is printed.
    return null;
  }
}

const environment = readEnvironment();
if (environment === null) {
  console.error('[FAIL] OWNER_ENV_INVALID');
  process.exit(1);
}
const { request, auth } = environment;
const db = createDb(environment.db);
try {
  const run = request.recover ? recoverOwner : provisionOwner;
  const outcome = await run(db, request, {
    totpKey: auth.totpKey,
    now: new Date(),
  });
  if (DONE.includes(outcome)) {
    console.log(`[OK] ${outcome}`);
  } else {
    console.error(`[FAIL] ${outcome}`);
    process.exitCode = 1;
  }
} catch {
  // Rolled back as a whole. The driver's message may quote a value: the code alone is printed.
  console.error(
    `[FAIL] ${request.recover ? 'OWNER_RECOVERY_TX_FAILED' : 'OWNER_PROVISION_TX_FAILED'}`
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
