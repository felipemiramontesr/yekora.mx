/**
 * The fiscal profile of the signed-in account (FC 077 F1): `/v1/account/fiscal-profile`, guarded
 * by `account:self`. The account is always the session's (A01), and the write runs once per
 * `Idempotency-Key`.
 *
 * @module
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  type FiscalDataRefusal,
  fiscalDataVerdict,
  fiscalProfileRequestSchema,
  fiscalProfileSavedSchema,
  fiscalProfileSchema,
} from '../../../../lib/account/fiscalTypes';
import { recordAudit } from '../services/audit';
import type { Db, Transactional } from '../services/db';
import {
  readFiscalProfile,
  saveFiscalProfile,
} from '../services/fiscalProfiles';
import { checkIdempotencyKey } from '../services/idempotency';
import type { SessionUser } from '../services/identity';
import { refuse, runOnce } from './catalogMutation';

/** Dependencies of the fiscal profile routes. */
interface AccountFiscalDeps {
  /** Database with transactions. */
  db: Db & Transactional;
  /** Clock. */
  now: () => Date;
  /** CHECKOUT_PII_KEY, or null when the checkout secrets are not configured (FC 047). */
  piiKey: Buffer | null;
}

/** The title of each refusal of T1.2; the code says which value failed. */
const TITLES: Readonly<Record<FiscalDataRefusal, string>> = {
  INVALID_RFC_REJECT: 'The RFC is not valid',
  INVALID_LEGAL_NAME_REJECT:
    'The legal name is not valid, or carries its capital regime',
  INVALID_TAX_SYSTEM_REJECT: 'The tax regime is not in the SAT catalog',
  INVALID_POSTAL_CODE_REJECT: 'The postal code is not valid',
  INVALID_CFDI_USE_REJECT: 'The CFDI use is not in the SAT catalog',
};

const unavailable = (reply: FastifyReply) =>
  refuse(
    reply,
    503,
    'Personal data cannot be read or saved right now',
    'SERVICE_UNAVAILABLE'
  );

/**
 * Registers the two routes of the fiscal profile.
 *
 * @param app - Fastify instance.
 * @param deps - Database, clock and the key of personal data.
 */
export function registerAccountFiscalRoutes(
  app: FastifyInstance,
  deps: AccountFiscalDeps
): void {
  app.get('/v1/account/fiscal-profile', async (request, reply) => {
    if (deps.piiKey === null) return unavailable(reply);
    const profile = await readFiscalProfile(
      deps.db,
      deps.piiKey,
      (request.user as SessionUser).userId
    );
    if (profile === null) {
      return refuse(
        reply,
        404,
        'No fiscal profile saved',
        'FISCAL_PROFILE_NOT_FOUND'
      );
    }
    return fiscalProfileSchema.parse(profile);
  });

  app.put('/v1/account/fiscal-profile', async (request, reply) => {
    const key = checkIdempotencyKey(request.headers['idempotency-key']);
    if (key.code !== 'IDEMP_KEY_ACCEPTED') {
      return refuse(reply, 400, 'Idempotency-Key required', key.code);
    }
    const { piiKey } = deps;
    if (piiKey === null) return unavailable(reply);
    const body = fiscalProfileRequestSchema.safeParse(request.body);
    if (!body.success) {
      return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
    }
    const verdict = fiscalDataVerdict({
      ...body.data,
      cfdiUse: body.data.defaultCfdiUse,
    });
    if (verdict !== 'FISCAL_DATA_ACCEPTED') {
      return refuse(reply, 400, TITLES[verdict], verdict);
    }
    return runOnce(deps, request, reply, key.key, async (tx, userId) => {
      await saveFiscalProfile(tx, piiKey, userId, body.data);
      await recordAudit(tx, {
        userId,
        action: 'FISCAL_PROFILE_SAVED',
        entityType: 'customer_fiscal_profiles',
        entityId: userId,
        before: null,
        after: null,
        ip: request.ip,
      });
      return {
        status: 200,
        body: fiscalProfileSavedSchema.parse({ saved: true }),
      };
    });
  });
}
