/**
 * Process entry of the API bundle (`node dist/index.js` on Hostinger, FC 008).
 *
 * Only wiring: start the API and stop it cleanly on SIGTERM/SIGINT. All the logic lives in
 * index.ts (`start`), which is unit-tested; this file is the single one excluded from coverage
 * because it only exists to bind the real process.
 *
 * @module
 */
import { start } from './index';

const { stop } = await start(process.env);
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void stop().then(() => process.exit(0));
  });
}
