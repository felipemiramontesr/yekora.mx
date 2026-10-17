# ADR 0005: SemVer for product versions and sovereign commit subjects

- **Status:** Accepted
- **Date:** 2026-10-14 (commit format) · 2026-10-16 (SemVer bump rule)
- **Source:** decisions of GrayMan (Ω); Protocol L annexes CODE_VERSIONING and COMMIT_DISCIPLINE

## Context

The project needs one readable version line that ties each release to the feature contract (FC)
that produced it. The style follows Archon's governance, with Yekora's own counter. Early pushes
bumped PATCH on every push, including new features. That is not what SemVer means: L's
`R-SEMVER-BUMP` reserves MINOR for features.

## Decision

- Scheme `semver`; the current value lives in `versioning.semver` of the local L configuration.
- **PATCH** for fixes and maintenance with no new behavior; **MINOR** for backward-compatible
  features (new pages, new capabilities); **MAJOR** for breaking changes, decided by Ω.
- Commit subject, in English and exactly in this form:
  `V.MAJOR.MINOR.PATCH_FC_<n>_<Pascal_Snake_Description>`. The body is in English and ends with
  the trailers `SemVer:` and `FC:`.
- Product code and its tests ship in the same commit. Published history is never rewritten to
  change versions or titles.

## Consequences

- `V.0.0.1`–`V.0.0.6` stay as published (PATCH-only history). The corrected rule applies forward
  from `V.0.1.0` (FC 004).
- Every release in `git log` maps to one FC, and production's `version.txt` maps back to the
  commit.
- `package.json` keeps its own version field untouched (`packageSync: false`). The SemVer
  source of truth is the L configuration and the commit trailers.
