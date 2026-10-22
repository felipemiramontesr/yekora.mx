import { describe, expect, it } from 'vitest';
import { PaymentProcessorError, remoteDeadline } from './paymentPort';

describe('payment port', () => {
  it('sets the processor deadline exactly 30 minutes (1 800 s) before the order hold', () => {
    const expiresAt = new Date('2026-10-21T20:00:00Z');
    expect(remoteDeadline(expiresAt)).toEqual(new Date('2026-10-21T19:30:00Z'));
    expect(expiresAt.getTime() - remoteDeadline(expiresAt).getTime()).toBe(
      1_800_000
    );
  });

  it('names its errors so callers can tell processor failures apart', () => {
    const error = new PaymentProcessorError('Stripe: HTTP 500');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PaymentProcessorError');
    expect(error.message).toBe('Stripe: HTTP 500');
  });
});
