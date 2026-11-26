/**
 * The second factor asked again for one delicate action (FC 075, K-75 second part, T1.3): having
 * a session is not enough, the person types the code of their authenticator for that action. The
 * code is never stored.
 *
 * @module
 */
import { decryptTotpSecret, verifyTotp } from './authCrypto';
import type { TxQuery } from './db';
import { totpOf } from './identity';
import { decideStepUp, type StepUpCode } from './paymentGates';

/**
 * Checks the code a signed-in person typed for a delicate action.
 *
 * @param db - Database port, or the transaction of the action.
 * @param check - The person, the code as typed, TOTP_ENCRYPTION_KEY and the clock.
 * @returns The row of T1.3; the session is the one the guard already accepted.
 */
export async function verifyStepUpTotp(
  db: TxQuery,
  check: { userId: string; code: string; totpKey: Buffer; now: Date }
): Promise<StepUpCode> {
  const stored = await totpOf(db, check.userId);
  if (stored === null || !stored.enabled) {
    return decideStepUp({ active: true, enrolled: false, valid: false });
  }
  const secret = decryptTotpSecret(
    check.totpKey,
    check.userId,
    stored.encrypted
  );
  return decideStepUp({
    active: true,
    enrolled: true,
    valid: verifyTotp(secret, check.code, check.now),
  });
}
