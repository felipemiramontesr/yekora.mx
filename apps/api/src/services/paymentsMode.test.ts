import { createHmac } from 'node:crypto';
import fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerAdminPaymentRoutes } from '../routes/adminPayments';
import { encryptTotpSecret } from './authCrypto';
import type { Db, Transactional } from './db';
import {
  alertModeApproved,
  noteProbeFailure,
  noteRejectedSignature,
} from './paymentAlerts';
import { assertPaymentsModeApproved } from './paymentsModeGate';
import { decideModeSwitch, decideStepUp } from './paymentGates';
import { confirmModeSwitch, prepareModeSwitch } from './paymentsModeSwitch';
import { verifyStepUpTotp } from './totpStepUp';

const NOW = new Date('2026-11-26T20:00:00Z');
const KEY = Buffer.alloc(32, 7);
const SECRET = Buffer.from('12345678901234567890');
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const HOUR = 60 * 60 * 1000;

/** The 6-digit code of the authenticator for a moment (RFC 6238). */
function code(at: Date): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 30_000)));
  const mac = createHmac('sha1', SECRET).update(counter).digest();
  const offset = mac.readUInt8(mac.length - 1) & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(
    6,
    '0'
  );
}

interface Ticket {
  id: number;
  challenge_id: string;
  target_mode: 'sandbox' | 'live';
  status: string;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  approval_expires_at: Date | null;
  activated_at: Date | null;
}

/** A database in memory with only what the switch, the gate and the alerts ask of it. */
function memory(options: { totp?: boolean } = {}) {
  const state = {
    tickets: [] as Ticket[],
    audit: [] as { action: string; entity: string; at: Date }[],
    outbox: [] as { type: string; payload: Record<string, unknown> }[],
    clock: NOW,
  };
  const find = (id: unknown) => state.tickets.find((t) => t.id === id)!;
  async function query(sql: string, p: unknown[] = []): Promise<unknown[]> {
    if (sql.startsWith('INSERT INTO payments_mode_tickets')) {
      state.tickets.push({
        id: state.tickets.length + 1,
        challenge_id: p[0] as string,
        target_mode: p[1] as 'live',
        status: 'PENDING',
        attempts: 0,
        expires_at: p[4] as Date,
        consumed_at: null,
        approval_expires_at: null,
        activated_at: null,
      });
      return [];
    }
    if (sql.startsWith('SELECT id, target_mode, status')) {
      return state.tickets.filter((t) => t.challenge_id === p[0]);
    }
    if (sql.startsWith('SELECT id, target_mode, approval_expires_at')) {
      return state.tickets
        .filter((t) => t.status === 'CONSUMED')
        .sort((a, b) => Number(b.consumed_at) - Number(a.consumed_at))
        .slice(0, 1);
    }
    if (sql.includes("SET status = 'EXPIRED'")) {
      find(p[0]).status = 'EXPIRED';
      return [];
    }
    if (sql.includes('SET attempts')) {
      Object.assign(find(p[2]), { attempts: p[0], status: p[1] });
      return [];
    }
    if (sql.includes("SET status = 'CONSUMED'")) {
      Object.assign(find(p[3]), {
        status: 'CONSUMED',
        consumed_at: p[0],
        approval_expires_at: p[2],
      });
      return [];
    }
    if (sql.includes('SET activated_at')) {
      find(p[1]).activated_at = p[0] as Date;
      return [];
    }
    if (sql.startsWith('SELECT totp_secret_encrypted')) {
      return options.totp === false
        ? []
        : [
            {
              totp_secret_encrypted: encryptTotpSecret(
                KEY,
                p[0] as string,
                SECRET
              ),
              is_totp_enabled: 1,
            },
          ];
    }
    if (sql.startsWith('SELECT DISTINCT u.id')) {
      return [{ id: OWNER }, { id: 'admin-id' }];
    }
    if (sql.startsWith('INSERT INTO audit_log')) {
      state.audit.push({
        action: p[1] as string,
        entity: p[3] as string,
        at: state.clock,
      });
      return [];
    }
    if (sql.startsWith('SELECT COUNT(*) AS n FROM audit_log')) {
      return [
        {
          n: state.audit.filter(
            (e) =>
              e.action === p[0] && e.entity === p[1] && e.at >= (p[2] as Date)
          ).length,
        },
      ];
    }
    if (sql.startsWith('INSERT INTO outbox_events')) {
      state.outbox.push({
        type: p[0] as string,
        payload: JSON.parse(p[1] as string) as Record<string, unknown>,
      });
      return [];
    }
    return [];
  }
  const db = {
    query,
    ping: async () => undefined,
    close: async () => undefined,
    transaction<T>(work: (tx: Db) => Promise<T>) {
      return work(this as unknown as Db);
    },
  } as unknown as Db & Transactional;
  return { state, db };
}

describe('T1.3 · StepUpTotpGate (FC 075)', () => {
  it.each([
    [true, true, true, 'STEP_UP_GRANTED_200'],
    [true, true, false, 'STEP_UP_CODE_INVALID_403'],
    [true, false, true, 'STEP_UP_NOT_ENROLLED_403'],
    [true, false, false, 'STEP_UP_NOT_ENROLLED_403'],
    [false, true, true, 'STEP_UP_UNAUTHORIZED_401'],
    [false, true, false, 'STEP_UP_UNAUTHORIZED_401'],
    [false, false, true, 'STEP_UP_UNAUTHORIZED_401'],
    [false, false, false, 'STEP_UP_UNAUTHORIZED_401'],
  ] as const)('A=%s E=%s C=%s → %s', (active, enrolled, valid, row) => {
    expect(decideStepUp({ active, enrolled, valid })).toBe(row);
  });

  it('checks the code against the stored secret, and says when none was enrolled', async () => {
    const check = { userId: OWNER, totpKey: KEY, now: NOW };
    const { db } = memory();
    await expect(
      verifyStepUpTotp(db, { ...check, code: code(NOW) })
    ).resolves.toBe('STEP_UP_GRANTED_200');
    await expect(
      verifyStepUpTotp(db, { ...check, code: '000000' })
    ).resolves.toBe('STEP_UP_CODE_INVALID_403');
    await expect(
      verifyStepUpTotp(memory({ totp: false }).db, {
        ...check,
        code: code(NOW),
      })
    ).resolves.toBe('STEP_UP_NOT_ENROLLED_403');
  });
});

describe('T1.1 · PaymentModeSwitchGate (FC 075)', () => {
  const values = [true, false];
  const rows = values.flatMap((challenge) =>
    values.flatMap((phrase) =>
      values.flatMap((totp) =>
        values.map((owner) => ({ challenge, phrase, totp, owner }))
      )
    )
  );
  it.each(rows)('S/P/T/O %o', (inputs) => {
    let expected = 'SWITCH_PERMITTED';
    if (!inputs.challenge) expected = 'SWITCH_CHALLENGE_INVALID';
    else if (!inputs.phrase) expected = 'SWITCH_PHRASE_MISMATCH';
    else if (!inputs.totp) expected = 'SWITCH_TOTP_FAILED';
    else if (!inputs.owner) expected = 'SWITCH_OWNER_REQUIRED';
    expect(decideModeSwitch(inputs)).toBe(expected);
  });
});

describe('the ticket and the approval (FC 075 T0.3)', () => {
  const actor = { userId: OWNER, ip: 'client-a' };
  const asked = async (db: Db) => {
    const ticket = await prepareModeSwitch(
      db,
      { targetMode: 'live', reason: 'ya', currentMode: 'sandbox' },
      actor,
      NOW
    );
    if (typeof ticket === 'string') throw new Error(ticket);
    return ticket;
  };
  const confirm = (
    db: Db,
    challengeId: string,
    change: Partial<Parameters<typeof confirmModeSwitch>[1]> = {},
    now = NOW
  ) =>
    confirmModeSwitch(
      db,
      {
        challengeId,
        confirmationPhrase: 'CONFIRMAR_CAMBIO_A_LIVE',
        totpCode: code(now),
        owner: true,
        totpKey: KEY,
        ...change,
      },
      actor,
      now
    );

  it('refuses to ask for the mode the API already runs', async () => {
    const { db, state } = memory();
    await expect(
      prepareModeSwitch(
        db,
        { targetMode: 'sandbox', reason: 'x', currentMode: 'sandbox' },
        actor,
        NOW
      )
    ).resolves.toBe('SWITCH_TARGET_UNCHANGED');
    expect(state.tickets).toHaveLength(0);
  });

  it('records a ticket of ten minutes with a random challenge and its audit', async () => {
    const { db, state } = memory();
    const ticket = await asked(db);
    expect(ticket.challengeId).toMatch(/^[0-9a-f]{64}$/);
    expect(ticket.expiresAt).toBe('2026-11-26T20:10:00.000Z');
    expect(state.audit.map((e) => e.action)).toEqual([
      'PAYMENTS_MODE_PREPARED',
    ]);
  });

  it('approves for 24 hours, tells the owner and the administrators, and cannot be used twice', async () => {
    const { db, state } = memory();
    const { challengeId } = await asked(db);
    await expect(confirm(db, challengeId)).resolves.toEqual({
      code: 'SWITCH_PERMITTED',
      targetMode: 'live',
      approvalExpiresAt: '2026-11-27T20:00:00.000Z',
    });
    expect(state.outbox.map((m) => m.type)).toEqual([
      'PAYMENTS_MODE_APPROVED',
      'PAYMENTS_MODE_APPROVED',
    ]);
    await expect(confirm(db, challengeId)).resolves.toBe(
      'SWITCH_CHALLENGE_INVALID'
    );
  });

  it('counts a wrong phrase or code, and closes the ticket at the third attempt', async () => {
    const { db, state } = memory();
    const { challengeId } = await asked(db);
    await expect(
      confirm(db, challengeId, { confirmationPhrase: 'SI' })
    ).resolves.toBe('SWITCH_PHRASE_MISMATCH');
    await expect(
      confirm(db, challengeId, { totpCode: '000000' })
    ).resolves.toBe('SWITCH_TOTP_FAILED');
    expect(state.tickets[0]).toMatchObject({ attempts: 2, status: 'PENDING' });
    await expect(
      confirm(db, challengeId, { totpCode: '000000' })
    ).resolves.toBe('SWITCH_TOTP_FAILED');
    expect(state.tickets[0]).toMatchObject({ attempts: 3, status: 'FAILED' });
    await expect(confirm(db, challengeId)).resolves.toBe(
      'SWITCH_CHALLENGE_INVALID'
    );
    expect(
      state.audit.filter((e) => e.action === 'PAYMENTS_STEP_UP_FAILED')
    ).toHaveLength(3);
  });

  it('refuses anyone but the owner after the ticket, phrase and code, without counting an attempt', async () => {
    const { db, state } = memory();
    const { challengeId } = await asked(db);
    await expect(confirm(db, challengeId, { owner: false })).resolves.toBe(
      'SWITCH_OWNER_REQUIRED'
    );
    expect(state.tickets[0]).toMatchObject({ attempts: 0, status: 'PENDING' });
  });

  it('refuses an unknown or expired ticket, and marks the expired one', async () => {
    const { db, state } = memory();
    await expect(confirm(db, 'f'.repeat(64))).resolves.toBe(
      'SWITCH_CHALLENGE_INVALID'
    );
    const { challengeId } = await asked(db);
    const later = new Date(NOW.getTime() + 11 * 60_000);
    await expect(confirm(db, challengeId, {}, later)).resolves.toBe(
      'SWITCH_CHALLENGE_INVALID'
    );
    expect(state.tickets[0].status).toBe('EXPIRED');
  });
});

describe('the start-up gate of live (FC 075 T2.1)', () => {
  const approval = (
    target: 'sandbox' | 'live',
    at: Date,
    activated: Date | null = null
  ): Ticket => ({
    id: Math.floor(at.getTime() / 1000),
    challenge_id: 'c',
    target_mode: target,
    status: 'CONSUMED',
    attempts: 0,
    expires_at: at,
    consumed_at: at,
    approval_expires_at: new Date(at.getTime() + 24 * HOUR),
    activated_at: activated,
  });
  const start = (tickets: Ticket[], mode: 'sandbox' | 'live', now = NOW) => {
    const world = memory();
    world.state.tickets.push(...tickets);
    return {
      ...world,
      result: assertPaymentsModeApproved(world.db, mode, now),
    };
  };

  it('asks nothing of sandbox', async () => {
    await expect(start([], 'sandbox').result).resolves.toBeUndefined();
  });

  it('refuses live with no approval, or when the latest approval is sandbox', async () => {
    await expect(start([], 'live').result).rejects.toThrow('is not live');
    const older = approval('live', new Date(NOW.getTime() - 5 * HOUR), NOW);
    const latest = approval('sandbox', new Date(NOW.getTime() - HOUR));
    await expect(start([older, latest], 'live').result).rejects.toThrow(
      'is not live'
    );
  });

  it('activates a fresh approval, and refuses one that expired unused', async () => {
    const fresh = start(
      [approval('live', new Date(NOW.getTime() - HOUR))],
      'live'
    );
    await fresh.result;
    expect(fresh.state.tickets[0].activated_at).toEqual(NOW);
    await expect(
      start([approval('live', new Date(NOW.getTime() - 25 * HOUR))], 'live')
        .result
    ).rejects.toThrow('expired before it was activated');
  });

  it('keeps restarting weeks later once activated', async () => {
    const old = new Date(NOW.getTime() - 21 * 24 * HOUR);
    await expect(
      start([approval('live', old, old)], 'live').result
    ).resolves.toBeUndefined();
  });
});

describe('the alerts of the payments (FC 075 T2.4)', () => {
  it('queues the notice of an approval for each privileged account', async () => {
    const { db, state } = memory();
    await alertModeApproved(db, 'sandbox');
    expect(state.outbox).toEqual([
      {
        type: 'PAYMENTS_MODE_APPROVED',
        payload: { userId: OWNER, targetMode: 'sandbox' },
      },
      {
        type: 'PAYMENTS_MODE_APPROVED',
        payload: { userId: 'admin-id', targetMode: 'sandbox' },
      },
    ]);
  });

  it('tells a processor that did not answer at most once an hour', async () => {
    const { db, state } = memory();
    await expect(noteProbeFailure(db, 'STRIPE', NOW)).resolves.toBe(true);
    await expect(noteProbeFailure(db, 'STRIPE', NOW)).resolves.toBe(false);
    await expect(noteProbeFailure(db, 'MERCADO_PAGO', NOW)).resolves.toBe(true);
    expect(state.outbox).toHaveLength(4);
  });

  it('tells the tenth bad signature in ten minutes, once an hour, and stops logging at the ceiling', async () => {
    const { db, state } = memory();
    const rejected = { processor: 'STRIPE', ip: 'client-b' };
    const results: boolean[] = [];
    for (let i = 0; i < 11; i += 1) {
      results.push(await noteRejectedSignature(db, rejected, NOW));
    }
    expect(results.indexOf(true)).toBe(9);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(state.outbox).toHaveLength(2);
    for (let i = 11; i < 120; i += 1) {
      await noteRejectedSignature(db, rejected, NOW);
    }
    expect(
      state.audit.filter((e) => e.action === 'WEBHOOK_SIGNATURE_REJECTED')
    ).toHaveLength(100);
  });
});

// A cold Fastify under the load of the full suite may take a few seconds to start.
describe('the routes of the switch (FC 075 F2)', { timeout: 30_000 }, () => {
  const app = async (roles: string[], options: { auth?: boolean } = {}) => {
    const world = memory();
    const server = fastify();
    server.decorateRequest('user', null);
    server.decorateRequest('outboxQueued', false);
    server.addHook('preHandler', async (request) => {
      request.user = { userId: OWNER, roles } as never;
    });
    registerAdminPaymentRoutes(server, {
      db: world.db,
      now: () => NOW,
      auth:
        options.auth === false
          ? null
          : ({ secret: KEY, totpKey: KEY } as never),
      mode: 'sandbox',
    });
    await server.ready();
    return { server, ...world };
  };
  const post = (
    server: Awaited<ReturnType<typeof app>>['server'],
    path: string,
    payload: object,
    headers: Record<string, string> = {}
  ) =>
    server.inject({
      method: 'POST',
      url: `/v1/admin/payments/mode/${path}`,
      payload,
      headers,
    });
  const key = { 'idempotency-key': 'k-1' };

  it('issues a ticket, refuses the current mode and a malformed body', async () => {
    const { server } = await app(['admin']);
    const created = await post(server, 'prepare', {
      targetMode: 'live',
      reason: 'ya',
    });
    expect(created.statusCode).toBe(201);
    const same = await post(server, 'prepare', {
      targetMode: 'sandbox',
      reason: 'x',
    });
    expect(same.statusCode).toBe(409);
    expect(same.json()).toMatchObject({ detail: 'SWITCH_TARGET_UNCHANGED' });
    const bad = await post(server, 'prepare', { targetMode: 'prod' });
    expect(bad.statusCode).toBe(400);
  });

  it('confirms for the owner, and answers each refusal with its code', async () => {
    const { server } = await app(['owner']);
    const ticket = (
      await post(server, 'prepare', { targetMode: 'live', reason: 'ya' })
    ).json<{ challengeId: string }>();
    const body = {
      challengeId: ticket.challengeId,
      confirmationPhrase: 'CONFIRMAR_CAMBIO_A_LIVE',
      totpCode: code(NOW),
    };
    const noKey = await post(server, 'confirm', body);
    expect(noKey.json()).toMatchObject({ detail: 'IDEMP_KEY_MISSING' });
    const malformed = await post(server, 'confirm', {}, key);
    expect(malformed.json()).toMatchObject({ detail: 'INVALID_REQUEST' });
    const wrong = await post(
      server,
      'confirm',
      { ...body, totpCode: '000000' },
      { 'idempotency-key': 'k-2' }
    );
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toMatchObject({ detail: 'SWITCH_TOTP_FAILED' });
    const done = await post(server, 'confirm', body, {
      'idempotency-key': 'k-3',
    });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ code: 'SWITCH_PERMITTED' });
  });

  it('answers SWITCH_OWNER_REQUIRED to an administrator, and 503 without identity secrets', async () => {
    const { server } = await app(['admin']);
    const ticket = (
      await post(server, 'prepare', { targetMode: 'live', reason: 'ya' })
    ).json<{ challengeId: string }>();
    const body = {
      challengeId: ticket.challengeId,
      confirmationPhrase: 'CONFIRMAR_CAMBIO_A_LIVE',
      totpCode: code(NOW),
    };
    const refused = await post(server, 'confirm', body, key);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ detail: 'SWITCH_OWNER_REQUIRED' });
    const without = await app(['owner'], { auth: false });
    const down = await post(without.server, 'confirm', body, key);
    expect(down.statusCode).toBe(503);
  });
});
