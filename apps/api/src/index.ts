/**
 * Startup of the YĒKORA API (FC 008). `server.ts` calls {@link start} on Hostinger (apiv1.yekora.mx).
 *
 * Validates the environment (fails closed), checks the Mercado Pago account against its mode
 * (FC 019), opens the MariaDB pool, builds the app and listens on Hostinger's PORT.
 * SIGTERM/SIGINT close the server and the pool cleanly.
 *
 * @module
 */
import { buildApp } from './app';
import { type PaymentsConfig, loadConfig } from './config';
import { createDb } from './services/db';
import { currentRate } from './services/exchangeRate';
import {
  verifyMercadoPagoLiveAccount,
  verifyMercadoPagoTestAccount,
} from './services/mercadoPagoAdapter';

/**
 * Checks that the Mercado Pago account matches the declared mode (FC 019 T1.0 to T1.2): none
 * configured is fine, a `TEST-` token in sandbox needs no call, and an `APP_USR-` token must
 * be a test account in sandbox and a real one in live.
 */
async function checkMercadoPagoAccount(
  payments: PaymentsConfig,
  fetchImpl: typeof fetch
): Promise<void> {
  const token = payments.mercadoPago?.accessToken;
  if (token === undefined) return;
  if (payments.mode === 'live') {
    await verifyMercadoPagoLiveAccount(token, fetchImpl);
  } else if (token.startsWith('APP_USR-')) {
    await verifyMercadoPagoTestAccount(token, fetchImpl);
  }
}

/**
 * Starts the API.
 *
 * @param env - Environment variables (usually `process.env`).
 * @param makeDb - Database factory, injectable for tests.
 * @param fetchImpl - `fetch` for the Mercado Pago account check, injectable for tests.
 * @returns The address it listens on, and a function that stops the server and closes the pool.
 * @throws When the environment is invalid or the Mercado Pago account does not match the mode.
 */
export async function start(
  env: Record<string, string | undefined>,
  makeDb: typeof createDb = createDb,
  fetchImpl: typeof fetch = fetch
): Promise<{ address: string; stop: () => Promise<void> }> {
  const config = loadConfig(env);
  // Before the pool opens, so a refused account leaves nothing to close.
  await checkMercadoPagoAccount(config.payments, fetchImpl);
  const db = makeDb(config.db);
  const app = await buildApp({
    config,
    db,
    rate: () => currentRate(db, config.banxicoToken),
    logger: config.isProduction,
  });
  const address = await app.listen({ port: config.port, host: config.host });
  return {
    address,
    stop: async () => {
      await app.close();
      await db.close();
    },
  };
}
