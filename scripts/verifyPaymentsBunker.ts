/**
 * Mechanical checks before real payments are switched on (FC 070 F1, K-75 + K-26; logic and
 * evidence in scripts/lib/paymentsBunker.ts). It reads the environment of the API, asks Stripe
 * whether its webhook is set up, and scans the files of the working tree for credentials in clear
 * text. It prints findings and never a value of a secret.
 *
 * With `--check-rotation` it also checks the keys and webhook secrets of a rotation (FC 075).
 *
 * CLI: `bun scripts/verifyPaymentsBunker.ts [--check-rotation]` with the production environment loaded
 * (CHECKOUT_PII_KEY, CUSTOMER_EMAIL_HMAC_PEPPER, ORDER_TOKEN_PEPPER, STRIPE_SECRET_KEY and
 * API_PUBLIC_URL; the key of Stripe needs `Webhooks: read`).
 * exit 0 = every check passed · exit 1 = at least one failed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkCheckoutSecrets,
  checkRotation,
  checkStripeWebhook,
  type Finding,
  formatReport,
  scanForSecrets,
} from './lib/paymentsBunker';

/** Folders that are not the source of the store: dependencies, builds, the local protocol files. */
const SKIPPED = new Set([
  'node_modules',
  '.git',
  '.next',
  'out',
  'dist',
  'coverage',
  'protocols',
  'test-results',
]);
/** The environment files .gitignore keeps out of the repository: they may hold a credential. */
const LOCAL_ENV = /^\.env(\..*\.local)?$|^\.env\.local$/;
const BINARY = /\.(png|jpe?g|webp|woff2?|ico|zip|gz)$/i;

/** The text files under `folder`, pruning the skipped folders before walking into them. */
function treeFiles(folder = '.'): { path: string; text: string }[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED.has(entry.name) ? [] : treeFiles(path);
    }
    return entry.isFile() &&
      !BINARY.test(entry.name) &&
      !LOCAL_ENV.test(entry.name)
      ? [{ path, text: readFileSync(path, 'utf8') }]
      : [];
  });
}

const { STRIPE_SECRET_KEY, API_PUBLIC_URL } = process.env;
const findings: Finding[] = [...checkCheckoutSecrets(process.env)];
findings.push(
  STRIPE_SECRET_KEY && API_PUBLIC_URL
    ? await checkStripeWebhook(STRIPE_SECRET_KEY, API_PUBLIC_URL)
    : {
        check: 'STRIPE_WEBHOOK_ENDPOINT',
        ok: false,
        detail: 'STRIPE_SECRET_KEY and API_PUBLIC_URL are needed to ask Stripe',
      },
  scanForSecrets(treeFiles())
);
if (process.argv.includes('--check-rotation')) {
  findings.push(...checkRotation(process.env));
}

const report = formatReport(findings);
console.log(report.text);
process.exit(report.ok ? 0 : 1);
