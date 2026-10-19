/**
 * Release build of the API (FC 008 F5 · R2: the CI is the only compiler).
 *
 * Bundles the API with every dependency into one CommonJS file, so Hostinger never installs or
 * compiles anything: it runs exactly the bytes the CI tested. The commit SHA is stamped into the
 * bundle (`__BUILD_SHA__`, read by server.ts), so `/health` proves which commit is live and the
 * deploy smoke test can compare it with `$GITHUB_SHA`. A minimal manifest without dependencies
 * goes next to it; the api-release branch is the content of dist/.
 *
 * CLI: `bun build.ts` from apps/api (`bun run build`). Outside CI the stamp is `dev`.
 *
 * @module
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string;
  engines: Record<string, string>;
};
const sha = process.env.GITHUB_SHA ?? 'dev';

// CommonJS on purpose: Hostinger's LiteSpeed starts the app with require(), which cannot load
// an ES module that awaits at the top level. A CommonJS bundle loads the same under require()
// and under `node index.js`.
await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outfile: 'dist/index.js',
  define: { __BUILD_SHA__: JSON.stringify(sha) },
  logLevel: 'info',
});

writeFileSync(
  'dist/package.json',
  `${JSON.stringify(
    {
      name: 'yekora-api',
      version: manifest.version,
      private: true,
      type: 'commonjs',
      description: `YEKORA API release ${sha}, built by CI. Do not edit: the next deploy replaces it.`,
      engines: manifest.engines,
      scripts: { start: 'node index.js' },
    },
    null,
    2
  )}\n`
);
console.log(`[OK] API release ${manifest.version} · ${sha} → dist/`);
