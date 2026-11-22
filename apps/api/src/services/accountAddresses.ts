/**
 * What an account keeps to ship and charge (FC 051): its phone and its book of delivery addresses.
 *
 * - Personal data is stored only as AES-256-GCM ciphertext made with CHECKOUT_PII_KEY and bound to
 *   its place: the phone to «<user id>|user_phone», an address to «<user id>|<address id>|user_address».
 *   A value copied to another account, row or column fails authentication and is never read.
 * - The state is not personal data and stays in the clear: the cart is quoted without opening any
 *   ciphertext.
 * - Every statement that touches an address names the account (`user_id = ?`): an id of someone
 *   else's reads as one that does not exist (OWASP A01).
 * - An account keeps at most {@link MAX_USER_ADDRESSES}; the count is taken under a lock on the
 *   account row, so two requests at once cannot both take the last place (A04).
 * - The default address is a pointer in `users`. The first address becomes the default; deleting
 *   the default makes the newest left, a complete one first, the default.
 *
 * Every statement is static SQL with `?` placeholders (A03).
 *
 * @module
 */
import { randomUUID } from 'node:crypto';
import {
  type AddressInput,
  type AddressView,
  addressContentSchema,
  MAX_USER_ADDRESSES,
} from '../../../../lib/account/addressTypes';
import { decryptPii, encryptPii } from './checkoutCrypto';
import type { Db, TxQuery } from './db';

/** Why a write to the book of addresses was refused. */
export type AddressRefusal = 'ADDRESS_NOT_FOUND' | 'ADDRESS_LIMIT_REACHED';

/** What a write to one address answers: the address, whether it is the default, whether complete. */
interface AddressSaved {
  id: string;
  isDefault: boolean;
  isComplete: boolean;
}

/** One row of `user_addresses` as it is read. */
interface AddressRow {
  id: string;
  state_code: string;
  is_complete: number;
  address_enc: Buffer;
}

/** The subject an address is sealed for. */
const subjectOf = (userId: string, addressId: string) =>
  `${userId}|${addressId}`;

/** The address row, sealed for its account and its id. */
function sealed(
  key: Buffer,
  userId: string,
  addressId: string,
  content: Record<string, unknown>
): Buffer {
  return encryptPii(
    key,
    subjectOf(userId, addressId),
    'user_address',
    JSON.stringify(content)
  );
}

/** What a row holds, opened for its account. */
function opened(key: Buffer, userId: string, row: AddressRow) {
  return addressContentSchema.parse(
    JSON.parse(
      decryptPii(
        key,
        subjectOf(userId, row.id),
        'user_address',
        row.address_enc
      )
    )
  );
}

/** An address as its holder reads it. */
function viewOf(
  key: Buffer,
  userId: string,
  row: AddressRow,
  defaultId: string | null
): AddressView {
  const content = opened(key, userId, row) as Partial<AddressInput> & {
    postalCode: string;
  };
  return {
    id: row.id,
    isDefault: row.id === defaultId,
    isComplete: Number(row.is_complete) === 1,
    stateCode: row.state_code,
    postalCode: content.postalCode,
    label: content.label ?? null,
    name: content.name ?? null,
    phone: content.phone ?? null,
    street: content.street ?? null,
    exteriorNumber: content.exteriorNumber ?? null,
    interiorNumber: content.interiorNumber ?? null,
    neighborhood: content.neighborhood ?? null,
    municipality: content.municipality ?? null,
    references: content.references ?? null,
  };
}

/**
 * The book of addresses of an account, oldest first.
 *
 * @param db - Database port.
 * @param key - CHECKOUT_PII_KEY.
 * @param userId - The account.
 * @returns Its addresses, each opened for its holder.
 * @throws When a stored value does not authenticate (altered, or moved to another row or account).
 */
export async function listAddresses(
  db: Db,
  key: Buffer,
  userId: string
): Promise<AddressView[]> {
  const rows = await db.query<AddressRow>(
    'SELECT id, state_code, is_complete, address_enc FROM user_addresses WHERE user_id = ? ORDER BY created_at ASC, id ASC',
    [userId]
  );
  const [owner] = await db.query<{ default_address_id: string | null }>(
    'SELECT default_address_id FROM users WHERE id = ?',
    [userId]
  );
  return rows.map((row) =>
    viewOf(key, userId, row, owner?.default_address_id ?? null)
  );
}

/** What `GET /v1/account/me` adds to the account: its phone and its default address' place. */
interface AccountDelivery {
  phone: string | null;
  postalCode: string | null;
  stateCode: string | null;
  /** The language of the account's mail (FC 067); not personal data, so given back even without the key. */
  preferredLocale: 'es-MX' | 'en';
}

/**
 * The phone of an account and the postal code and state of its default address, opened for its
 * holder (FC 051 T2.3): the header shows them.
 *
 * @param db - Database port.
 * @param key - CHECKOUT_PII_KEY, or null when the checkout secrets are not configured.
 * @param userId - The account.
 * @returns Its phone and its default address' place, null where there is none or no key.
 * @throws When a stored value does not authenticate.
 */
export async function accountDelivery(
  db: Db,
  key: Buffer | null,
  userId: string
): Promise<AccountDelivery> {
  const [row] = await db.query<{
    phone_enc: Buffer | null;
    address_id: string | null;
    state_code: string | null;
    address_enc: Buffer | null;
    preferred_locale: 'es-MX' | 'en';
  }>(
    'SELECT u.phone_enc, u.preferred_locale, a.id AS address_id, a.state_code, a.address_enc FROM users u LEFT JOIN user_addresses a ON a.id = u.default_address_id AND a.user_id = u.id WHERE u.id = ?',
    [userId]
  );
  const preferredLocale = row.preferred_locale;
  if (key === null) {
    return { phone: null, postalCode: null, stateCode: null, preferredLocale };
  }
  // The address columns come from one LEFT JOIN row: all three are there, or none is.
  const address = row.address_enc
    ? opened(key, userId, {
        id: row.address_id as string,
        state_code: row.state_code as string,
        is_complete: 0,
        address_enc: row.address_enc,
      })
    : null;
  return {
    phone: row.phone_enc
      ? decryptPii(key, userId, 'user_phone', row.phone_enc)
      : null,
    postalCode: address?.postalCode ?? null,
    stateCode: address ? row.state_code : null,
    preferredLocale,
  };
}

/**
 * Changes the name and the phone of an account; the e-mail never changes.
 *
 * @param tx - Transaction of the request.
 * @param key - CHECKOUT_PII_KEY.
 * @param userId - The account.
 * @param profile - The name and the 10-digit phone.
 */
export async function updateProfile(
  tx: TxQuery,
  key: Buffer,
  userId: string,
  profile: {
    fullName: string;
    phone: string;
    preferredLocale?: 'es-MX' | 'en';
  }
): Promise<void> {
  // FC 067 T1.2: a profile without a language leaves the account's language as it was.
  await tx.query(
    'UPDATE users SET full_name = ?, phone_enc = ?, preferred_locale = COALESCE(?, preferred_locale) WHERE id = ?',
    [
      profile.fullName,
      encryptPii(key, userId, 'user_phone', profile.phone),
      profile.preferredLocale ?? null,
      userId,
    ]
  );
}

/** Inserts one sealed address and, when it is the account's first or asked for, makes it the default. */
async function insertAddress(
  tx: TxQuery,
  key: Buffer,
  userId: string,
  address: {
    stateCode: string;
    content: Record<string, unknown>;
    makeDefault: boolean;
  }
): Promise<AddressSaved> {
  const id = randomUUID();
  await tx.query(
    'INSERT INTO user_addresses (id, user_id, state_code, is_complete, address_enc) VALUES (?, ?, ?, ?, ?)',
    [id, userId, address.stateCode, 1, sealed(key, userId, id, address.content)]
  );
  if (address.makeDefault) {
    await tx.query('UPDATE users SET default_address_id = ? WHERE id = ?', [
      id,
      userId,
    ]);
  }
  return { id, isDefault: address.makeDefault, isComplete: true };
}

/**
 * Adds an address to the book, unless it already holds {@link MAX_USER_ADDRESSES}.
 *
 * @param tx - Transaction of the request.
 * @param key - CHECKOUT_PII_KEY.
 * @param userId - The account.
 * @param input - The whole address.
 * @param wantsDefault - Whether to make it the default (the first one always is).
 * @returns What was saved, or the refusal.
 */
export async function createAddress(
  tx: TxQuery,
  key: Buffer,
  userId: string,
  input: AddressInput,
  wantsDefault: boolean
): Promise<AddressSaved | 'ADDRESS_LIMIT_REACHED'> {
  // The lock serialises the count: two requests at once cannot both take the last place.
  await tx.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
  const [{ placed }] = await tx.query<{ placed: number }>(
    'SELECT COUNT(*) AS placed FROM user_addresses WHERE user_id = ?',
    [userId]
  );
  if (Number(placed) >= MAX_USER_ADDRESSES) return 'ADDRESS_LIMIT_REACHED';
  return insertAddress(tx, key, userId, {
    stateCode: input.stateCode,
    content: input,
    makeDefault: wantsDefault || Number(placed) === 0,
  });
}

/** Whether the account's row for this address exists, locking it. */
async function ownedBy(
  tx: TxQuery,
  userId: string,
  addressId: string
): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(
    'SELECT id FROM user_addresses WHERE id = ? AND user_id = ? FOR UPDATE',
    [addressId, userId]
  );
  return rows.length > 0;
}

/**
 * Edits an address, or only makes it the default. A whole address also completes the one given
 * at sign-up.
 *
 * @param tx - Transaction of the request.
 * @param key - CHECKOUT_PII_KEY.
 * @param userId - The account.
 * @param addressId - The address.
 * @param change - A whole address (with its choice of default) or just `{ isDefault: true }`.
 * @returns What was saved, or the refusal when the address is not this account's.
 */
export async function updateAddress(
  tx: TxQuery,
  key: Buffer,
  userId: string,
  addressId: string,
  change: (AddressInput & { isDefault?: boolean }) | { isDefault: true }
): Promise<AddressSaved | 'ADDRESS_NOT_FOUND'> {
  if (!(await ownedBy(tx, userId, addressId))) return 'ADDRESS_NOT_FOUND';
  const { isDefault, ...content } = change;
  let isComplete = true;
  if ('postalCode' in content) {
    await tx.query(
      'UPDATE user_addresses SET state_code = ?, is_complete = 1, address_enc = ? WHERE id = ? AND user_id = ?',
      [
        content.stateCode,
        sealed(key, userId, addressId, content),
        addressId,
        userId,
      ]
    );
  } else {
    const [row] = await tx.query<{ is_complete: number }>(
      'SELECT is_complete FROM user_addresses WHERE id = ? AND user_id = ?',
      [addressId, userId]
    );
    isComplete = Number(row.is_complete) === 1;
  }
  if (isDefault) {
    await tx.query('UPDATE users SET default_address_id = ? WHERE id = ?', [
      addressId,
      userId,
    ]);
  }
  const [owner] = await tx.query<{ default_address_id: string | null }>(
    'SELECT default_address_id FROM users WHERE id = ?',
    [userId]
  );
  return {
    id: addressId,
    isDefault: owner.default_address_id === addressId,
    isComplete,
  };
}

/**
 * Deletes an address. If it was the default, the newest one left (a complete one first) takes its
 * place; with none left the account has no default.
 *
 * @param tx - Transaction of the request.
 * @param userId - The account.
 * @param addressId - The address.
 * @returns Nothing, or the refusal when the address is not this account's.
 */
export async function deleteAddress(
  tx: TxQuery,
  userId: string,
  addressId: string
): Promise<'ADDRESS_NOT_FOUND' | null> {
  if (!(await ownedBy(tx, userId, addressId))) return 'ADDRESS_NOT_FOUND';
  await tx.query('DELETE FROM user_addresses WHERE id = ? AND user_id = ?', [
    addressId,
    userId,
  ]);
  // The foreign key cleared the default if it was this one; the newest left takes its place.
  const [owner] = await tx.query<{ default_address_id: string | null }>(
    'SELECT default_address_id FROM users WHERE id = ?',
    [userId]
  );
  if (owner.default_address_id === null) {
    const [next] = await tx.query<{ id: string }>(
      'SELECT id FROM user_addresses WHERE user_id = ? ORDER BY is_complete DESC, created_at DESC, id DESC LIMIT 1',
      [userId]
    );
    if (next) {
      await tx.query('UPDATE users SET default_address_id = ? WHERE id = ?', [
        next.id,
        userId,
      ]);
    }
  }
  return null;
}
