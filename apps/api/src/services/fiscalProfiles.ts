/**
 * The fiscal profile an account keeps to be invoiced (FC 077 F1): one per account.
 *
 * The legal name and the postal code are stored only as AES-256-GCM ciphertext made with
 * CHECKOUT_PII_KEY and bound to the account and the column (T2.4): copied to another row it fails
 * authentication. Every statement is static SQL with `?` placeholders (A03) and names the account.
 *
 * @module
 */
import type { FiscalProfile } from '../../../../lib/account/fiscalTypes';
import { decryptPii, encryptPii } from './checkoutCrypto';
import type { Db, TxQuery } from './db';

/**
 * Reads the profile of an account, opened for its holder.
 *
 * @param db - Database port.
 * @param key - CHECKOUT_PII_KEY.
 * @param userId - The account.
 * @returns The profile, or null when the account has not saved one.
 * @throws When a stored value does not authenticate.
 */
export async function readFiscalProfile(
  db: Db,
  key: Buffer,
  userId: string
): Promise<FiscalProfile | null> {
  const [row] = await db.query<{
    rfc: string;
    legal_name_enc: Buffer;
    tax_system: string;
    postal_code_enc: Buffer;
    default_cfdi_use: string;
  }>(
    'SELECT rfc, legal_name_enc, tax_system, postal_code_enc, default_cfdi_use FROM customer_fiscal_profiles WHERE user_id = ?',
    [userId]
  );
  if (row === undefined) return null;
  return {
    rfc: row.rfc,
    legalName: decryptPii(key, userId, 'fiscal_legal_name', row.legal_name_enc),
    taxSystem: row.tax_system,
    postalCode: decryptPii(
      key,
      userId,
      'fiscal_postal_code',
      row.postal_code_enc
    ),
    defaultCfdiUse: row.default_cfdi_use,
  };
}

/**
 * Saves the profile of an account, replacing the one it had.
 *
 * @param tx - Transaction of the request.
 * @param key - CHECKOUT_PII_KEY.
 * @param userId - The account.
 * @param profile - Data the gate T1.2 accepted.
 */
export async function saveFiscalProfile(
  tx: TxQuery,
  key: Buffer,
  userId: string,
  profile: FiscalProfile
): Promise<void> {
  await tx.query(
    'INSERT INTO customer_fiscal_profiles (user_id, rfc, legal_name_enc, tax_system, postal_code_enc, default_cfdi_use) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE rfc = VALUES(rfc), legal_name_enc = VALUES(legal_name_enc), tax_system = VALUES(tax_system), postal_code_enc = VALUES(postal_code_enc), default_cfdi_use = VALUES(default_cfdi_use)',
    [
      userId,
      profile.rfc,
      encryptPii(key, userId, 'fiscal_legal_name', profile.legalName),
      profile.taxSystem,
      encryptPii(key, userId, 'fiscal_postal_code', profile.postalCode),
      profile.defaultCfdiUse,
    ]
  );
}
