# ADR 0014: Cumulative ISO/IEC 25010 Quality Framework and Zod to OpenAPI 3.1 Contract Enforcement

- **Status:** Accepted (FC 027 · K-44)
- **Date:** 2026-11-01
- **Architectural Reference:** ADR 0011 (Platform Architecture)
- **Source:** Sovereign decisions of GrayMan (Ω) (chat, 2026-11-01; transmitted by Charlie in H 2026-11-01 17:10:14 / 17:37:43; formal analysis 240_AN, 241_AN, 242_AN, 245_AN).

## Context

GrayMan (Ω) established ISO/IEC 25010 as programmatic law for Yēkora (`standards.isoProfile: "both"`), mandating zero `NOT_VERIFIED` across all software quality and security domains. To prevent superficial compliance or regression, quality gates must be introduced cumulatively and permanently across feature contracts.

Furthermore, introducing dynamic admin and customer endpoints on the Fastify API poses a risk of API contract divergence between client and server, or accidental breaking changes across releases.

## Decision

1. **Cumulative Quality Domain Gates (No Regressions):**
   - Quality domains are assigned to specific Feature Contracts and become **permanent mechanical gates in CI**:
     - `027_FC` (K-44): **Q03** (Co-existence / Compatibility via Zod to OpenAPI 3.1 contracts);
     - `028_FC` (K-45): **S02** (Access Control / ASVS 4.0 L2) + **Q06** (Modifiability / Audit Log);
     - `029_FC` (K-46): **Q05** (Fault Tolerance / Idempotency Key & Optimistic Locking);
     - `030_FC` (K-47): **Q02** (Performance Efficiency / Keyset Pagination & p95 < 100ms);
     - `031_FC` (K-48): **S04** (Non-Repudiation / Transactional Outbox & Correlation IDs);
     - `032_FC` (K-49): **Q01** (Functional Appropriateness / ARCO Compliance) + **Q04** (Usability / Accessibility WCAG 2.1 AA in admin views);
     - `033_FC` (K-50): **S06** (Authenticity & Continuity / Automated RTO $\le$ 15min and RPO $\le$ 1h verification on MariaDB with real media volume).

2. **Domain Q03 Contract Enforcement:**
   - Fastify request/response schemas are declared using strong Zod schemas.
   - Schemas are exported canonically to the OpenAPI 3.1 specification.
   - A deterministic CI test (`scripts/lib/contractValidation.test.ts`) verifies:
     - 1:1 bidirectional mapping between registered Fastify routes and OpenAPI endpoints;
     - Absence of undocumented query parameters, body properties, or response headers;
     - Anti-breaking changes verification against baseline API contracts.

## Consequences

- **Pros:** Total contract predictability; automated regression prevention; formal satisfaction of ISO/IEC 25010 standard law.
- **Cons:** Additional boilerplate when adding API routes; requires upfront schema modeling in Zod for all endpoints.
