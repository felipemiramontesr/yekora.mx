# ADR 0007: Prohibition of ENUM/SET for Domain Values and Use of Reference Tables

- **Status:** Accepted / Proposed (applies to FC 008 and all future database contracts)
- **Date:** 2026-10-18
- **Source:** Directive of GrayMan (Ω) (chat, 2026-10-18): «Carefully consider ENUM data types; prioritize scalability. An ENUM can break system scalability if not architected properly.» Supported by forensic analysis in 060_AN regarding Archon's multi-phase refactoring of legacy ENUMs.

## Context

Relational database engines such as MariaDB provide `ENUM(...)` and `SET(...)` column types. While convenient for initial prototyping, `ENUM` types embed business domain values directly into the table definition (DDL).

Historical evidence from sister project Archon demonstrates the severe operational cost of altering or extending `ENUM` columns over time:

- Adding or modifying values requires schema-altering DDL (`ALTER TABLE`) which can lock large production tables.
- Multiple patches were required (e.g. patches 026 and 084 in Archon), culminating in a complex 5-phase migration (FC 082) to replace ENUMs with relational reference tables. In that process, a subtle column drop in migration 169 broke two production views (MySQL error 1356).
- Furthermore, database ENUMs encourage developers to define rigid TypeScript string union types in frontend applications, forcing complete application redeployments whenever business introduces a new option.

## Decision

1. **Database Rule:**
   - **Prohibition:** The use of `ENUM(...)` and `SET(...)` in MariaDB tables is strictly prohibited for domain values.
   - **Dedicated Reference Tables:** Any evolving set of domain options (such as product categories, technical difficulty levels, order statuses, shipping methods) must be modeled as a **dedicated reference table** per domain entity (avoiding anti-pattern generic polymorphic lookup tables).
   - **Reference Table Schema:** Every reference table must define:
     - `id`: integer primary key (auto-increment).
     - `slug`: unique, immutable varchar identifier (used in URLs, API parameters, and filters).
     - `name_es` and `name_en`: localized display names.
     - `sort_order`: integer for UI sequencing.
     - `is_active`: boolean flag for soft-retirement (`is_active = FALSE`). Physical `DELETE` is prohibited.
   - **Foreign Keys:** Domain tables reference these tables using integer foreign keys with `ON DELETE RESTRICT`, preventing orphaned child records.

2. **TypeScript & API Boundary:**
   - Values originating from the database are typed dynamically (e.g. `string` validated with Zod against DB-returned entities), not as closed TypeScript string unions that would require frontend code modifications when a new row is inserted.
   - **Permitted Union Types:** Closed TypeScript string unions are restricted strictly to constants bound to the application code itself (e.g. supported locales `'es-MX' | 'en'`, HTTP methods, routing identifiers).
   - **Documented Exception:** The 5 brand disciplines in `app/i18n.ts` are currently bound to fixed UI pictograms and layout navigation (FC 002–004). The database `categories` table represents the source of catalog truth; dynamic registration of new disciplines with custom iconography will be handled in a future dedicated contract.

3. **Automated CI Enforcement:**
   - An automated CI guard (`scripts/checkNoEnum.ts`) will inspect all SQL migration files in `migrations/`.
   - The build fails immediately if any SQL file contains `ENUM(` or `SET(` definitions.

## Consequences

- Full business scalability: adding a new discipline, experience level, or order state is an `INSERT` operation, with zero table locks, zero schema modifications, and zero required frontend re-compilations.
- Enhanced data integrity: relational foreign keys ensure strict domain referential integrity.
- Zero risk of schema-related view corruption or breaking DDL alter locks in production.
