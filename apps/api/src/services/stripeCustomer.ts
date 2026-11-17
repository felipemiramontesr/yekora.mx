/**
 * The link between an account and its Stripe customer (FC 054 T2.1): one row of
 * `user_stripe_customers` holding the opaque customer id (`cus_…`) and nothing about any card.
 * The cards live at Stripe; this table only says whose customer they belong to.
 *
 * @module
 */
import type { Db } from './db';
import type { StripeCardsPort } from './stripeAdapter';

/** The queries this module needs: a plain connection or the one of a transaction. */
type Queryable = Pick<Db, 'query'>;

/**
 * The Stripe customer of an account, if it has one.
 *
 * @param db - Database or transaction.
 * @param userId - The account.
 * @returns The customer id, or null while the account has never saved a card.
 */
export async function linkedCustomer(
  db: Queryable,
  userId: string
): Promise<string | null> {
  const [row] = await db.query<{ stripe_customer_id: string }>(
    'SELECT stripe_customer_id FROM user_stripe_customers WHERE user_id = ?',
    [userId]
  );
  return row?.stripe_customer_id ?? null;
}

/**
 * The Stripe customer of an account, created and linked the first time it is needed. Two requests
 * at once end up with the same customer: Stripe returns the same one for the same account (its
 * idempotency key is the account) and the link is written once.
 *
 * @param db - Database or transaction.
 * @param cards - The Stripe client.
 * @param userId - The account.
 * @returns The customer id.
 */
export async function ensureCustomer(
  db: Queryable,
  cards: StripeCardsPort,
  userId: string
): Promise<string> {
  const existing = await linkedCustomer(db, userId);
  if (existing !== null) return existing;
  const created = await cards.createCustomer(userId);
  await db.query(
    'INSERT INTO user_stripe_customers (user_id, stripe_customer_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id',
    [userId, created]
  );
  return created;
}
