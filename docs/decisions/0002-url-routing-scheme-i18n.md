# ADR 0002: Spanish at the root, English under /en/ with translated slugs

- **Status:** Accepted
- **Date:** 2026-10-16
- **Source:** FC 003, Amendment 1 (approved by GrayMan, Ω)

## Context

The first version served both languages under `/es-MX/…` and `/en/…`, with middleware that
redirected `/` by `Accept-Language` and remembered the choice in a cookie. A static export cannot
run middleware. The redirect also hid the Spanish home from crawlers, and the cookie trapped
English visitors who wanted to go back to Spanish.

## Decision

- Spanish (the default market) lives at the root: `/`, `/nosotros/`, `/privacidad/`…
- English lives under `/en/` with translated slugs: `/en/`, `/en/about/`, `/en/privacy/`…
- `lib/routes.ts` holds the single route map. The language switcher maps each page to its
  translation, and every page declares a canonical URL and an hreflang pair, with Spanish as
  `x-default`.
- No redirect by browser language and no language cookie: the URL is the only source of the
  language. Old `/es-MX/…` links get a 301 to the root equivalent in `.htaccess`.
- Two root layouts (`app/(es)` and `app/(en)/en`) set `<html lang>`; see ADR 0004.

## Consequences

- Clean, indexable URLs in both languages. The site declares a single technical cookie, the
  notice itself.
- Every new page needs one entry in the route map and two route files, one per language.
  The RWD gate and route tests list each page explicitly.
- Prices will show MXN, with a USD reference in English, as content of each page and not as a
  URL dimension.
