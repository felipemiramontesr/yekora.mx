# Host boot file (L-Harness)

> Local notes below/above the L-HARNESS markers are preserved by `l sync-hosts`.

## Quality gate (Yekora)

SonarQube Cloud. Un FC que no quede en A, con 0 issues y cobertura 100, no pasa. Ver `sonar-quality-gate.json` y `AGENTS.md`.

<!-- L-HARNESS:BEGIN protocolVersion=V.1.9.16-core do-not-edit-inside -->

# GrayMan L-Harness — Claude Code instructions

> **SSOT:** `protocols/north-star/001_NS_ProtocolL.md` — if this file and L diverge, **L prevails**.  
> Protocol V.1.9.16-core · Harness 1.6.0 · Official: https://github.com/GrayMan/l-harness

## North Star

```
NO SIGNED FC = NO PRODUCT CODE.
```

Do **not** re-list all Protocol L rules here. Read L for R-*, Conduct, OWASP, OLR, CHANNEL H.

## Session start

1. Read `protocols/north-star/001_NS_ProtocolL.md` (North Star + CHANNEL H + Conduct when relevant)
2. Read `protocols/north-star/002_NS_Handoff.md` **header + delta after your cursor only**
3. ACK via **hPost** (not by hand-editing H)

## H channel (MANDATORY)

```bash
node scripts/hPost.mjs --author <Callsign> --message "line1\nline2\n…"
# ≤6 non-empty lines; broker sets timestamp + cursor
node scripts/hCheck.mjs
```

Long dictámenes → `protocols/analysis/` or the FC file.

## Code quality (portable)

Non-trivial product FCs must declare **structure** (modules, layering, couplings, DRY notes).  
See `CODE_QUALITY` annex · profile default **standard**. Complements `MAINTAINABILITY` (docs/comments).

## Industrial base (portable)

Auth/money/PII/public API/jobs → threat note + secrets hygiene + observability plan.  
Annexes under `protocols/annex/security/`. Honesty > theater (`CI_TRUTH` / `R-OWASP-EVIDENCE`).

## Triggers (see L for full table)

| Trigger        | Action                                                      |
| -------------- | ----------------------------------------------------------- |
| L              | Read L + H delta + ACK via hPost                            |
| H              | Catch up delta + ACK via hPost                              |
| K              | Backlog / next priority                                     |
| S / SC         | Signed FC · SC = re-read L each phase                       |
| **KAE**        | Learn L once → **[KAE START ACK]** + **L_pin** → token diet |
| `l sync-hosts` | Refresh this managed block after L upgrades                 |

### KAE START ACK (copy shape)

```
[KAE START ACK] protocolVersion=… L_pin=… FC=… Learned(L)=⊤ token_mode=diet next=Phase n
```

## Ω

Project Ω alias: **GrayMan** (GrayMan brand verified=true)  
Raptors: Alfa (Antigravity) seat O · Bravo (Grok) seat R · Charlie (Claude Code) seat O

## GrayMan L-Harness

Improvements → PRs to **https://github.com/GrayMan/l-harness** only. GrayMan identity is reserved to the author.
<!-- L-HARNESS:END -->
