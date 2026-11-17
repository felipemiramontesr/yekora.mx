/**
 * The saved cards of the signed-in account (FC 054): list them, open Stripe's page to add one, and
 * detach one. Every card is read from Stripe each time and forgotten: this database keeps only the
 * customer id (PCI DSS SAQ A, T2.1). A card is reached only through the customer of the account
 * that asks, so another account's card id is the same 404 as one that does not exist (T2.2).
 *
 * @module
 */
import type { SavedCard } from '../../../../lib/account/paymentMethodTypes';
import type { Db } from './db';
import type { StripeCardsPort } from './stripeAdapter';
import { ensureCustomer, linkedCustomer } from './stripeCustomer';

/** The queries these functions need: a plain connection or the one of a transaction. */
type Queryable = Pick<Db, 'query'>;

/** Why a card could not be detached: it does not exist, or it is not this account's. */
type PaymentMethodRefusal = 'PAYMENT_METHOD_NOT_FOUND';

/**
 * The cards of the account.
 *
 * @param db - Database or transaction.
 * @param cards - The Stripe client.
 * @param userId - The account.
 * @returns The cards, and whether the account has a customer at Stripe yet.
 */
export async function listSavedCards(
  db: Queryable,
  cards: StripeCardsPort,
  userId: string
): Promise<{ items: SavedCard[]; hasCustomer: boolean }> {
  const customerId = await linkedCustomer(db, userId);
  if (customerId === null) return { items: [], hasCustomer: false };
  return { items: await cards.listCards(customerId), hasCustomer: true };
}

/**
 * Opens Stripe's hosted page to add a card to the account's customer, created if need be.
 *
 * @param db - Database or transaction.
 * @param cards - The Stripe client.
 * @param userId - The account.
 * @param returnTo - Where Stripe sends the person after adding the card or giving up.
 * @returns The address of the hosted page.
 */
export async function startCardSetup(
  db: Queryable,
  cards: StripeCardsPort,
  userId: string,
  returnTo: { successUrl: string; cancelUrl: string }
): Promise<string> {
  const customerId = await ensureCustomer(db, cards, userId);
  return cards.createSetupSession({ customerId, ...returnTo });
}

/**
 * Detaches a card of the account at Stripe. A card of another account, one already gone and one
 * that never existed all answer the same refusal, and nothing is detached.
 *
 * @param db - Database or transaction.
 * @param cards - The Stripe client.
 * @param userId - The account.
 * @param paymentMethodId - Stripe id of the card.
 * @returns A refusal, or null when the card was detached.
 */
export async function detachSavedCard(
  db: Queryable,
  cards: StripeCardsPort,
  userId: string,
  paymentMethodId: string
): Promise<PaymentMethodRefusal | null> {
  const customerId = await linkedCustomer(db, userId);
  if (customerId === null) return 'PAYMENT_METHOD_NOT_FOUND';
  const owner = await cards.cardOwner(paymentMethodId);
  if (owner !== customerId) return 'PAYMENT_METHOD_NOT_FOUND';
  await cards.detachCard(paymentMethodId);
  return null;
}
