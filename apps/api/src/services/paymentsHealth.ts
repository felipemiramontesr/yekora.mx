/**
 * The payments health probe (FC 070 T2.2): asks each configured processor, with its read-only
 * `ping()`, whether it can be reached with the credentials of this environment, and reports the
 * mode of payments. Nothing of the processors (keys, accounts, messages) goes into the answer.
 *
 * @module
 */
import type { PaymentsHealth } from '../../../../lib/account/paymentsHealthTypes';
import type { PaymentsConfig } from '../config';
import type { ProcessorCode } from './checkout';
import type { PaymentProcessorPort } from './paymentPort';

type Processors = Partial<Record<ProcessorCode, PaymentProcessorPort>>;

/** One processor: absent, or whether it answered. A ping that throws counts as unreachable. */
async function probe(
  port: PaymentProcessorPort | undefined
): Promise<PaymentsHealth['processors']['stripe']> {
  if (port === undefined) return 'unconfigured';
  const answered = await port.ping().catch(() => false);
  return answered ? 'ok' : 'unreachable';
}

/**
 * Probes both processors at once.
 *
 * @param mode - `PAYMENTS_MODE` of this environment.
 * @param processors - The processors whose secrets are configured.
 * @returns The mode and the state of each processor; `degraded` when one that is configured does
 *   not answer, or when none is configured (the checkout is then closed).
 */
export async function readPaymentsHealth(
  mode: PaymentsConfig['mode'],
  processors: Processors
): Promise<PaymentsHealth> {
  const [stripe, mercadoPago] = await Promise.all([
    probe(processors.STRIPE),
    probe(processors.MERCADO_PAGO),
  ]);
  const states = [stripe, mercadoPago];
  const healthy = states.includes('ok') && !states.includes('unreachable');
  return {
    status: healthy ? 'ok' : 'degraded',
    mode,
    processors: { stripe, mercadoPago },
  };
}
