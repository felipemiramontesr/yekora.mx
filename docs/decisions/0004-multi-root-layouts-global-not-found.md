# ADR 0004: One root layout per language, and a global 404 document

- **Status:** Accepted
- **Date:** 2026-10-16 (layouts, FC 003) · 2026-10-17 (404, FC 004)
- **Source:** FC 003 and FC 004

## Context

Each language must render `<html lang="es-MX">` or `<html lang="en">` in static HTML, without
client JavaScript. A single root layout cannot know the language of a static page unless the
language is a route parameter, and ADR 0002 removed that segment. A 404 also has no layout of
its own once there are two roots: Next.js 15 needs a dedicated document for it.

## Decision

- Two route groups, each with its own root layout: `app/(es)/layout.tsx` (es-MX) and
  `app/(en)/en/layout.tsx` (en). Both are one line that renders
  `components/views/SiteShell.tsx` with their locale, so the document is written once.
- Page bodies live in shared views (`components/views/*View.tsx`) that take the locale, so each
  route file is a thin wrapper and Sonar duplication stays at 0 %.
- The 404 is `app/global-not-found.tsx`, enabled by `experimental.globalNotFound` in
  `next.config.ts`. It renders its own document with the same shell (Spanish first, English
  repeated with its own `lang`), and the export writes it to `out/404.html`. Apache serves it
  with status 404 for every unknown path.

## Consequences

- Correct `lang` and metadata per language in pure static HTML.
- `globalNotFound` is an experimental Next.js flag. A Next.js upgrade must re-check that the
  export still writes the branded `out/404.html`; the E2E suite and the deploy smoke test check
  its text.
- Shared views are the only place where page structure lives; a new page is a view and two
  wrappers.
