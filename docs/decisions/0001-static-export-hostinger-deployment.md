# ADR 0001: Static export on Hostinger, deployed by CI over a confined key

- **Status:** Accepted
- **Date:** 2026-10-16
- **Source:** FC 003, decided by GrayMan (Ω)

## Context

Hostinger Cloud Professional hosts `yekora.mx` with its document root at
`domains/yekora.mx/public_html`. The same account (`u701509674`) also serves Archon, a
production system that must not be affected. The plan offers PHP/static hosting and SSH, but no
managed Node runtime for this domain. Hostinger's own Git auto-deployment would publish
unverified commits.

## Decision

- Build the site with Next.js `output: 'export'` and `trailingSlash: true`: plain HTML, CSS and JS
  in `out/`, served by Apache. Routing rules live in `public/.htaccess`.
- Deploy only from GitHub Actions, after the global certification job, on pushes to `main`.
  Hostinger auto-deployment stays off.
- Use a dedicated ed25519 key, forced by `authorized_keys` to `rrsync` on
  `domains/yekora.mx/public_html` with `restrict`. The host key is pinned through the
  `SSH_KNOWN_HOSTS` secret, with `StrictHostKeyChecking=yes`. No password is used.
- Before every rsync, a probe fails the job if the key opens a shell or can list above its
  folder. rsync publishes the contents of `out/` into `./` (the folder itself, never a nested
  copy), with `--delete` and `--exclude='.well-known/'`.
- After the deploy, a smoke test requires `version.txt` to equal the commit SHA, plus 200
  responses on key pages and 404 on an unknown path.

## Consequences

- No server-side code in production: features that need data (catalog, cart, checkout) require
  a separate API, which needs its own ADR when it comes.
- A compromised CI secret can only write the yekora.mx folder; Archon stays out of reach. The
  probe re-checks that on every deploy.
- Each deploy replaces the site atomically enough for a static site. Rollback is a revert
  through the same pipeline (see `docs/runbooks/incident-response.md`).
- `rrsync` is a user-installed script (`~/bin/rrsync`, rsync v3.2.7, SHA-256 verified), so an
  account migration must reinstall it.
