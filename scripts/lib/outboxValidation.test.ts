import { describe, expect, it } from 'vitest';
import {
  OUTBOX_DISPATCHER,
  outboxViolations,
  retryDelaySeconds,
} from './outboxValidation';

describe('outboxViolations (FC 027 T2.5, ADR 0013)', () => {
  it('lets the dispatcher, and only it, import the SMTP client', () => {
    const files = new Map([
      [OUTBOX_DISPATCHER, "import nodemailer from 'nodemailer';"],
      ['apps/api/src/services/auth.ts', "import { enqueue } from './outbox';"],
    ]);
    expect(outboxViolations(files)).toEqual([]);
  });

  it('refuses SMTP in a service or a route, however it is imported', () => {
    const files = new Map([
      [
        'apps/api/src/services/auth.ts',
        "import { createTransport } from 'nodemailer';",
      ],
      [
        'apps/api/src/routes/signup.ts',
        "const smtp = await import('nodemailer/lib/smtp-transport');",
      ],
      ['apps/api/src/services/legacy.ts', "const mail = require('emailjs');"],
    ]);
    expect(outboxViolations(files)).toEqual([
      'apps/api/src/services/auth.ts imports the SMTP client nodemailer (only the outbox dispatcher may)',
      'apps/api/src/routes/signup.ts imports the SMTP client nodemailer/lib/smtp-transport (only the outbox dispatcher may)',
      'apps/api/src/services/legacy.ts imports the SMTP client emailjs (only the outbox dispatcher may)',
    ]);
  });

  it('refuses a route that calls the dispatcher instead of enqueueing', () => {
    const files = new Map([
      [
        'apps/api/src/routes/account.ts',
        "import { dispatch } from '../services/outboxDispatcher';",
      ],
    ]);
    expect(outboxViolations(files)).toEqual([
      'apps/api/src/routes/account.ts imports the outbox dispatcher (a route only enqueues)',
    ]);
  });

  it('ignores tests, which may fake the transport', () => {
    expect(
      outboxViolations(
        new Map([
          ['apps/api/src/services/auth.test.ts', "import 'nodemailer';"],
        ])
      )
    ).toEqual([]);
  });
});

describe('retryDelaySeconds (ADR 0013 §2)', () => {
  it('doubles from the base and stops at the cap', () => {
    expect([1, 2, 3, 4].map((attempt) => retryDelaySeconds(attempt))).toEqual([
      30, 60, 120, 240,
    ]);
    expect(retryDelaySeconds(20)).toBe(3600);
    expect(retryDelaySeconds(0, 10, 100)).toBe(10);
  });
});
