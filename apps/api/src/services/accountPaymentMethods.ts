/**
 * The saved cards of the signed-in account (FC 054, FC 057): list them, open Stripe's page to add
 * one, keep only the newest, and detach one. Every card is read from Stripe each time and forgotten: this database keeps only the
 * customer id (PCI DSS SAQ A, T2.1). A card is reached only through the customer of the account
 * that asks, so another account's card id is the same 404 as one that does not exist (T2.2).
 *
 * @module
 */
import type { SavedCard } from '../../../../lib/account/paymentMethodTypes';
import type { Db } from './db';
import { PaymentProcessorError } from './paymentPort';
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
  // The newest first: an account keeps one card and the first is the one to show (FC 057).
  const held = await cards.listCards(customerId);
  return {
    items: [...held].sort((first, second) => second.created - first.created),
    hasCustomer: true,
  };
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

/** What settling the cards of an account left: the one card it keeps, and the ones that gave way. */
interface SettledCards {
  /** The card the account keeps now (the newest). */
  card: SavedCard;
  /** Stripe ids of the cards detached because a newer one took their place (none for a first card). */
  replaced: string[];
}

/** Why the cards could not be settled. */
type SettleRefusal = 'CARD_ATTACH_FAILED' | 'GATEWAY_DETACH_FAILED';

/**
 * Leaves the account with one card (FC 057 T1.1, T2.1): the newest one Stripe holds for the
 * customer, which is the one just added on its hosted page, stays, and every older one is
 * detached. It is the step after Stripe's page and can be repeated: a second call finds nothing
 * more to detach, and one that failed half way is finished by the next. Only the customer of the
 * account is read, so another account's card is never reached.
 *
 * @param db - Database or transaction.
 * @param cards - The Stripe client.
 * @param userId - The account.
 * @returns The card kept and the ones replaced; `CARD_ATTACH_FAILED` when Stripe holds no card for
 *   the account (S ∧ ⊥V); `GATEWAY_DETACH_FAILED` when an older card could not be detached (V ∧ ⊥D).
 */
export async function settleSavedCards(
  db: Queryable,
  cards: StripeCardsPort,
  userId: string
): Promise<SettledCards | SettleRefusal> {
  const customerId = await linkedCustomer(db, userId);
  if (customerId === null) return 'CARD_ATTACH_FAILED';
  const held = await cards.listCards(customerId);
  const [newest, ...older] = [...held].sort(
    (first, second) => second.created - first.created
  );
  if (newest === undefined) return 'CARD_ATTACH_FAILED';
  try {
    await Promise.all(older.map((card) => cards.detachCard(card.id)));
  } catch (error) {
    if (!(error instanceof PaymentProcessorError)) throw error;
    return 'GATEWAY_DETACH_FAILED';
  }
  const { id, brand, last4, expMonth, expYear } = newest;
  return {
    card: { id, brand, last4, expMonth, expYear },
    replaced: older.map((card) => card.id),
  };
}
