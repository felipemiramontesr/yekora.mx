# ADR 0006: Node.js API on Hostinger (apiv1.yekora.mx) and MariaDB Catalog

- **Status:** Proposed (updated for FC 008 Enmienda 3)
- **Date:** 2026-10-18
- **Source:** decision of GrayMan (Ω) (chat, 2026-10-18): «API = Node app on Hostinger like Archon, MariaDB like Archon, identical encryption, stepwise local and prod execution, subdomain apiv1.yekora.mx»

## Context

The front-end of YÉKORA is a static export hosted on Apache in Hostinger (`yekora.mx`), benefiting from ultra-fast static asset delivery and high security (ADR 0001). To introduce dynamic features—starting with the product catalog (K-03), inventory, shopping cart (K-04), and checkout (K-05)—the site requires dynamic data persistence and business logic.

Per ADR 0003, MariaDB is selected as the database engine with hand-written parameterized SQL and zero ORM. However, the static Apache environment cannot execute Node.js scripts or directly interface with MariaDB. Hostinger Cloud/Business hosting provides the ability to run Node.js applications under a dedicated subdomain (`apiv1.yekora.mx`).

Inspiration and operational parity are drawn from Archon (`mantenimiento_piic`), with specific security hardenings and architecture decisions refined across analyses 054_AN through 061_AN.

## Decision

1. **Subdomain and Runtime:**
   - The API will run on the dedicated subdomain `apiv1.yekora.mx` on Hostinger.
   - Built with **Node.js 24**, **Fastify 5**, raw **`mysql2`** connection pooling, and **Zod** schema validation.
   - The web client interacts with `https://apiv1.yekora.mx/v1/*` using native `fetch` (no superfluous dependencies like SWR).
   - **Monorepo Structure:** The static frontend stays in the root of the repository. Only `apps/api` is added as a Bun workspace (`workspaces: ["apps/api"]`), preserving all existing build and deployment paths.

2. **Deployment Pipeline (Single Certified Path):**
   - Hostinger Git auto-deploy on `main` is disabled.
   - The Hostinger Node app tracks a dedicated protected release branch: **`api-release`**.
   - Only the GitHub Actions CI (`deploy.yml`) is permitted to push to `api-release` after global certification passes.
   - Hostinger compiles and runs on `api-release`. Smoke test checks `https://apiv1.yekora.mx/health` and verifies that the reported SHA matches `$GITHUB_SHA`.
   - Manual restart by GrayMan via Hostinger hPanel is documented as an operational incident runbook action.

3. **Security & Operational Controls:**
   - **R1 (Self-hosted runner in public repo / A1 Domain):** Residual risk accepted explicitly by Ω. GitHub repository policy set to «Require approval for all external contributors». The migrations workflow (`db-migrations.yml`) is triggered exclusively via manual `workflow_dispatch` on upstream `main` with required manual approval in the `production-db` environment. The runner uses the dedicated label `runs-on: [self-hosted, yekora-db]`. Prohibited `pull_request_target` across all workflows.
   - **R3 & Encryption scope:** The catalog in FC 008 contains no personal data (cero PII). To prevent dead code in violation of DC4, AES-256-GCM and HMAC blind indexing are reserved for customer data contracts (K-04/K-05).
   - **R5 (Error handling):** Production error responses return RFC 7807 Problem Details with zero stack traces or internal paths exposed (OWASP A05).
   - **R7 (CORS & CSP):** CORS allowlist restricted to `https://yekora.mx`, `http://localhost:3000`, and `http://localhost:3100`. Complete CSP deployed in `.htaccess` and `yekora.conf`.

4. **Data Layer and Catalog Modeling (DB_LAW · ADR 0007):**
   - Relational 3NF in MariaDB (`utf8mb4_unicode_ci` / InnoDB).
   - Strict adherence to ADR 0007: zero `ENUM` or `SET` types. Evolving options use dedicated reference tables (`categories`, `experience_levels`) with immutable slugs, soft-retirement (`is_active`), and `ON DELETE RESTRICT`. Verified by `checkNoEnum.ts`.
   - Single pricing source of truth: integer cents in Mexican Pesos (`price_mxn_cents`). No duplicate `price_usd_cents` column.
   - Dynamic USD reference calculated from the official **Banxico SIE API REST** (serie `SF43718` FIX) with host allowlist (`https://www.banxico.org.mx`), server-side caching in `exchange_rates`, and secret `BANXICO_TOKEN` managed by Ω.
   - Production migrations seed only categories and levels; the production `products` table starts empty until real items are formally loaded by Admin in K-07. Local testing uses `migrations/seed_dev.sql`.
   - AST CI guard (`scripts/checkNoRawSql.ts`) enforcing parameterized queries and forbidding string interpolation or concatenation.

5. **Static Export Integration:**
   - Catalog detail pages use `generateStaticParams()` at build time, ensuring pre-rendered HTML and SEO compatibility with Next.js static export (`output: 'export'`). Tolerates empty product sets in production without failing the build.

## Consequences

- Clean separation of concerns: static presentation stays on Apache (`yekora.mx`), dynamic business logic resides in `apiv1.yekora.mx`.
- The database remains inaccessible to the public Internet, reachable only via local/whitelisted credentials.
- Zero risk of pricing divergence or schema alteration locks from legacy ENUMs.
