/**
 * FC 070 T2.2 evidence of the probe: each configured processor is asked once, a failure of one is
 * reported without touching the other, and nothing of the processors goes into the answer.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PaymentProcessorPort } from './paymentPort';
import { readPaymentsHealth } from './paymentsHealth';

/** A processor whose ping answers `answer`, or throws when it is an Error. */
function port(answer: boolean | Error): PaymentProcessorPort {
  return {
    createSession: vi.fn(),
    verifyWebhook: vi.fn(),
    fetchPayment: vi.fn(),
    ping: vi.fn(async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  };
}

describe('readPaymentsHealth', () => {
  it('both answer: ok, with the mode', async () => {
    await expect(
      readPaymentsHealth('live', {
        STRIPE: port(true),
        MERCADO_PAGO: port(true),
      })
    ).resolves.toEqual({
      status: 'ok',
      mode: 'live',
      processors: { stripe: 'ok', mercadoPago: 'ok' },
    });
  });

  it('one is not configured and the other answers: still ok', async () => {
    await expect(
      readPaymentsHealth('sandbox', { STRIPE: port(true) })
    ).resolves.toEqual({
      status: 'ok',
      mode: 'sandbox',
      processors: { stripe: 'ok', mercadoPago: 'unconfigured' },
    });
  });

  it.each([
    ['answers false', false],
    ['throws', new Error('boom')],
  ])(
    'a configured processor that %s is unreachable and degrades',
    async (_n, answer) => {
      await expect(
        readPaymentsHealth('sandbox', {
          STRIPE: port(true),
          MERCADO_PAGO: port(answer),
        })
      ).resolves.toEqual({
        status: 'degraded',
        mode: 'sandbox',
        processors: { stripe: 'ok', mercadoPago: 'unreachable' },
      });
    }
  );

  it('none configured: degraded, because the checkout is closed', async () => {
    await expect(readPaymentsHealth('sandbox', {})).resolves.toEqual({
      status: 'degraded',
      mode: 'sandbox',
      processors: { stripe: 'unconfigured', mercadoPago: 'unconfigured' },
    });
  });

  it('never carries more than the mode and the three words', async () => {
    const answer = await readPaymentsHealth('live', {
      STRIPE: port(false),
      MERCADO_PAGO: port(true),
    });
    expect(Object.keys(answer).sort()).toEqual([
      'mode',
      'processors',
      'status',
    ]);
    expect(JSON.stringify(answer)).not.toMatch(/sk_|rk_|whsec|APP_USR|TEST-/);
  });
});
