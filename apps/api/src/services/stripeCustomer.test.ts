import { describe, expect, it, vi } from 'vitest';
import type { Db } from './db';
import type { StripeCardsPort } from './stripeAdapter';
import { ensureCustomer, linkedCustomer } from './stripeCustomer';

const USER = 'f0000000-0000-4000-8000-000000000001';

/** A database that holds at most one link, and can refuse the insert as a unique key would. */
function memory(link: string | null, insertFails: Error | null = null) {
  const state = { link, inserts: 0 };
  const db: Pick<Db, 'query'> = {
    async query<Row>(text: string) {
      if (text.startsWith('SELECT stripe_customer_id')) {
        return (
          state.link === null ? [] : [{ stripe_customer_id: state.link }]
        ) as Row[];
      }
      state.inserts += 1;
      if (insertFails !== null) throw insertFails;
      state.link = 'cus_new';
      return [] as Row[];
    },
  };
  return { db, state };
}
const stripe = (id = 'cus_new') =>
  ({
    createCustomer: vi.fn(async () => id),
  }) as unknown as StripeCardsPort;

describe('stripeCustomer (FC 054 T2.1)', () => {
  it('finds the link of an account, or none', async () => {
    expect(await linkedCustomer(memory('cus_1').db, USER)).toBe('cus_1');
    expect(await linkedCustomer(memory(null).db, USER)).toBeNull();
  });

  it('gives back the customer the account already has, asking Stripe nothing', async () => {
    const cards = stripe();
    expect(await ensureCustomer(memory('cus_old').db, cards, USER)).toBe(
      'cus_old'
    );
    expect(cards.createCustomer).not.toHaveBeenCalled();
  });

  it('creates and links the customer the first time', async () => {
    const { db, state } = memory(null);
    expect(await ensureCustomer(db, stripe(), USER)).toBe('cus_new');
    expect(state.inserts).toBe(1);
  });

  it('takes the link a concurrent request of the same account wrote first', async () => {
    const { db, state } = memory(null, new Error('ER_DUP_ENTRY'));
    // The other request's link appears once this insert is refused.
    const original = db.query.bind(db);
    db.query = (async (text: string, params?: readonly unknown[]) => {
      try {
        return await original(text, params);
      } catch (error) {
        state.link = 'cus_other_request';
        throw error;
      }
    }) as Db['query'];
    expect(await ensureCustomer(db, stripe(), USER)).toBe('cus_other_request');
  });

  it('lets a refused insert surface when no link of this account exists (a customer of someone else)', async () => {
    const { db } = memory(null, new Error('ER_DUP_ENTRY'));
    await expect(ensureCustomer(db, stripe(), USER)).rejects.toThrow(
      'ER_DUP_ENTRY'
    );
  });
});
