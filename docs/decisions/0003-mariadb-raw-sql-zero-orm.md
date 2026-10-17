# ADR 0003: MariaDB with parameterized SQL and no ORM

- **Status:** Accepted (applies from the catalog feature contract on; no database exists yet)
- **Date:** 2026-10-16
- **Source:** decision of GrayMan (Ω): «use the resources Hostinger provides: MariaDB; ORMs are
  forbidden, it must be raw SQL»

## Context

The store will need persistent data: catalog, stock, orders, customers. The Hostinger plan
already includes MariaDB, so a separate database service is not needed. ORMs hide the SQL that
actually runs, add a heavy dependency surface and make performance and security review harder.

## Decision

- The database engine is **MariaDB** on Hostinger.
- Data access uses **hand-written SQL with bound parameters only**. **No ORM of any kind** is
  allowed, light or heavy, nor any query builder that generates SQL.
- No query is ever built by concatenating user input. A CI guard in the spirit of Archon's
  `checkNoRawSql` will reject string-built queries (OWASP A03).
- Schema changes are idempotent, versioned migrations, run twice locally before production
  (L `DB_LAW`). They run in a separate migrations workflow, as GrayMan indicated.

## Consequences

- Every query is visible and reviewable; the schema is designed in 3NF unless a feature contract
  justifies otherwise.
- The project writes its own small typed data-access layer and its tests, instead of getting
  models for free.
- The static site will need an API to reach MariaDB. Where it runs is decided in its own ADR,
  since the static hosting has no Node runtime (ADR 0001).
