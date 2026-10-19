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

/** Commit stamped by apps/api/build.ts; absent when running unbundled. */
declare const __BUILD_SHA__: string | undefined;

// The stamp wins over any GIT_SHA in the server environment: /health must report the bytes
// that actually run, not a value someone typed in hPanel.
const sha = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : undefined;
const env = sha ? { ...process.env, GIT_SHA: sha } : process.env;

function onStarted({ stop }: { stop: () => Promise<void> }): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void stop().then(() => process.exit(0));
    });
  }
}

// Fail closed and visibly: the message reaches Hostinger's log, never a browser.
function onFailed(error: unknown): never {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[FAIL] API did not start: ${reason}`);
  process.exit(1);
}

// No top-level await: Hostinger's LiteSpeed loads the entry file with require(), which cannot
// load a module that awaits at the top level (ERR_REQUIRE_ASYNC_MODULE, the F5 503). The
// promise chain is required here, so Sonar's "prefer top-level await" (S7785) does not apply.
start(env).then(onStarted, onFailed); // NOSONAR S7785
