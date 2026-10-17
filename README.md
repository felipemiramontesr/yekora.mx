# YĒKORA · yekora.mx

Storefront of **YĒKORA**, a Mexican multi-brand outdoor store: gear, clothing and accessories for
hiking, mountaineering, climbing, canyoning and trail running.

Live at **https://yekora.mx** (Spanish) and **https://yekora.mx/en/** (English).

## What it is today

A static, bilingual site exported by Next.js and served by Apache on Hostinger:

- Home with the five disciplines, brand philosophy and the Mexican-brands section.
- About us, privacy notice, cookie policy, terms of use, and shipping and returns.
- A branded bilingual 404, a single technical cookie (the notice itself) and no analytics.

**It is not yet** a shop: there is no catalog, cart, checkout, customer account, database or
API. Those come in later feature contracts, in the order of the project backlog.

## Stack

| Layer     | Choice                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------- |
| Framework | Next.js 15.5 (App Router) with `output: 'export'` — static HTML, no Node runtime in production |
| UI        | React 19, TypeScript 5.7, Tailwind CSS 3.4, Lucide icons + in-house discipline pictograms      |
| i18n      | `messages/es-MX.json` (canonical) and `messages/en.json`; Spanish at `/`, English under `/en/` |
| Tests     | Vitest 3 (unit, 100 % coverage enforced) · Playwright 1.64 (E2E, RWD gate, contrast)           |
| Tooling   | Bun 1.3, ESLint 9 + SonarJS, Prettier, Husky + lint-staged                                     |
| Quality   | SonarQube Cloud (A/A/A, 0 issues, 100 % coverage, 0 % duplication)                             |
| Hosting   | Hostinger, `domains/yekora.mx/public_html`, deployed by rsync over SSH                         |

Data, when it arrives, will be MariaDB with parameterized SQL and **no ORM** (ADR 0003).

## Repository map

```
app/            Routes: app/(es)/… Spanish at the root, app/(en)/en/… English; global-not-found.tsx
components/     Header, Footer, banners, icons/ and views/ shared by both languages
lib/routes.ts   Route map, language switching and page metadata (canonical + hreflang)
messages/       Dictionaries (all user-facing text lives here)
public/         Brand SVGs and .htaccess, published as is (DC4 rejects unreferenced files)
e2e/            Playwright suites; e2e/apache/ configures the CI Apache container
scripts/        CI gates (DC4, TSDoc coverage, audits, pipeline integrity, local static server)
docs/           Architecture decisions (docs/decisions) and runbooks (docs/runbooks)
```

## Commands

```bash
bun install --frozen-lockfile
bun run dev            # local dev server
bun run build          # static export to out/
bun run test           # unit tests with coverage (fails under 100 %)
bun run test:e2e       # builds, serves out/ locally and runs Playwright
bun run lint           # ESLint + SonarJS rules
bun run typecheck      # tsc --noEmit
bun run check:tsdoc    # every exported declaration documented (TSDoc)
bun scripts/checkDeadExports.ts   # DC4: no dead exports, no unreferenced public/ file
```

The pre-commit hook runs lint-staged and the full unit suite with coverage.

## Delivery pipeline

One workflow, `.github/workflows/deploy.yml`, on every push and pull request to `main`:

1. Frontend verification in shards: dependency audit, lint, typecheck, TSDoc gate, unit tests.
2. Secret scan (TruffleHog), E2E against Apache with the real `.htaccess`, SonarQube Cloud gate.
3. Global certification: OWASP A04/A06/A08 checks, DC4 and diff-scoped quality.
4. **Deployment to Hostinger**, only for certified pushes to `main`:
   - a probe first checks that the deploy key is confined to the site's folder;
   - rsync publishes `out/`;
   - a smoke test confirms that `version.txt` serves the deployed commit.

Rollback is a revert commit through the same pipeline; see `docs/runbooks/incident-response.md`.

## Decisions and operations

- `docs/decisions/` — architecture decision records (ADR 0001–0005).
- `docs/runbooks/incident-response.md` — severities, owner, rollback, deploy-key rotation.

## Governance

Work follows **Protocol L** (V.1.9.15-core): every product change is a signed feature contract
with phased delivery, tests in the same commit, and an O ∧ L ∧ R seal before it is final.
Commit subjects follow `V.MAJOR.MINOR.PATCH_FC_<n>_<Description>` with `SemVer:` and `FC:`
trailers. The governance workspace (`protocols/`) is kept locally and is not part of this
repository.
