import { describe, expect, it } from 'vitest';
import {
  FULFILLMENT_CODES,
  ORDER_STATUS_CODES,
  splitStatus,
} from './checkoutTypes';

describe('splitStatus (FC 068 T0.2, ADR 0014)', () => {
  it.each(ORDER_STATUS_CODES)(
    'keeps %s as the status a client knows, with no fulfillment step',
    (code) => {
      expect(splitStatus(code)).toEqual({ status: code, fulfillment: null });
    }
  );

  it.each(FULFILLMENT_CODES)(
    '%s is a paid order: its status stays PAID and the step travels apart',
    (code) => {
      expect(splitStatus(code)).toEqual({ status: 'PAID', fulfillment: code });
    }
  );
});
