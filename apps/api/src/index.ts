/**
 * Startup of the YĒKORA API (FC 008). `server.ts` calls {@link start} on Hostinger (apiv1.yekora.mx).
 *
 * Validates the environment (fails closed), opens the MariaDB pool, builds the app and listens
 * on Hostinger's PORT. SIGTERM/SIGINT close the server and the pool cleanly.
 *
 * @module
 */
import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './services/db';
import { currentRate } from './services/exchangeRate';

/**
 * Starts the API.
 *
 * @param env - Environment variables (usually `process.env`).
 * @param makeDb - Database factory, injectable for tests.
 * @returns The address it listens on, and a function that stops the server and closes the pool.
 */
export async function start(
  env: Record<string, string | undefined>,
  makeDb: typeof createDb = createDb
): Promise<{ address: string; stop: () => Promise<void> }> {
  const config = loadConfig(env);
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
