# Agent instructions (L-Harness)

1. **SSOT:** `protocols/north-star/001_NS_ProtocolL.md`
2. **NO SIGNED FC = NO PRODUCT CODE**
3. **Holy Trinity:** product FC close ⇒ **O ∧ L ∧ R** (L = human Ω only)
4. **KAE:** `Learned(L)=⊤` + **KAE START ACK** + **L_pin** before work; re-anchor = pin check (`R-TOKEN-DIET`)
5. **Token diet:** no full L re-dump while pin holds; phase budget = FC slice + code + H delta
6. **Phase DAG / FC FSM:** respect `needs[]`; no invented phases; no code in PROPUESTO
7. **Asimov-L / ROE / A0 only Ω**
8. **OWASP Top 10** + **Argument** F01–F10
9. Session start: read L + H once; after L upgrades: `l sync-hosts`
10. Publish to H via `L p` (message diet)
11. **No Archon ERP cosmology** in portable

## Precedence

`Ω break-glass (A0) > signed L/FC > A1 > A2 > A3 > model preference`

## Default roster (Ω base)

| Who         | Identity    | Seat  | Craft                                 |
| ----------- | ----------- | ----- | ------------------------------------- |
| **GrayMan** | human Ω     | **L** | owner (omnipotent / omnipresent · A0) |
| Alfa        | Antigravity | **O** | architect                             |
| Bravo       | Grok        | **R** | auditor, security, formal             |
| Charlie     | Claude Code | **O** | fullstack                             |

OLR: **O** = Alfa \| Charlie · **R** = Bravo · **L** = GrayMan

## Quality gate (Yekora)

SonarQube Cloud. Cada FC queda impecable o no pasa. Ley en `sonar-quality-gate.json`:

- Reliability, Security, Security Review y Maintainability en **A**
- Bugs, vulnerabilidades, code smells y hotspots en **0**
- Duplicación **0%**
- Cobertura de líneas, ramas y condiciones **100%**

`bun run test:coverage` falla por debajo de 100. El workflow `.github/workflows/sonar.yml` espera el Quality Gate. Secreto `SONAR_TOKEN`. Cero `NOSONAR`. El código de `app/` no se saca del denominador.
<!-- L-HARNESS: managed region added by l sync-hosts — edit outside markers only -->
<!-- L-HARNESS:BEGIN protocolVersion=V.1.9.15-core do-not-edit-inside -->

# GrayMan L-Harness — AGENTS.md (host boot)

**SSOT (law):** `protocols/north-star/001_NS_ProtocolL.md`  
**Handoff:** `protocols/north-star/002_NS_Handoff.md`  
**Harness:** 1.6.0 · **L protocol:** V.1.9.15-core  
**Official repo:** https://github.com/GrayMan/l-harness  
**Ω:** GrayMan (verified=true)

## North Star

```
NO SIGNED FC = NO PRODUCT CODE.
```

If this file disagrees with L → **L wins**. Do not re-state the full rule catalog here.

## Boot checklist

1. Read **L** (`protocols/north-star/001_NS_ProtocolL.md`) + **H** header + **delta after your cursor** (`protocols/north-star/002_NS_Handoff.md`)
2. **Holy Trinity:** product close ⇒ O ∧ L ∧ R (L = human Ω only)
3. **KAE:** study L **before work** → **[KAE START ACK]** + **L_pin** → token diet
4. **R-TOKEN-DIET:** FC slice + code + H delta
5. **Asimov-L + ROE · OWASP · Argument · Phase DAG**
6. After L upgrades → **`l sync-hosts`**

## H channel (MANDATORY)

| Rule          | Action                                                                                |
| ------------- | ------------------------------------------------------------------------------------- |
| **Write**     | ONLY `node scripts/hPost.mjs --author <Callsign> --message "..."` (or `l p` if wired) |
| **Diet**      | ≤ **6** non-empty body lines — hPost rejects longer                                   |
| **Time**      | Full `YYYY-MM-DD HH:MM:SS` from broker                                                |
| **Read**      | Cursors → posts after your `@line` only                                               |
| **Long text** | `protocols/analysis/` or FC — not H                                                   |
| **Check**     | `node scripts/hCheck.mjs`                                                             |

## Commits (portable)

`commitMessage.profile` default **standard**: English title/body. See `COMMIT_DISCIPLINE` annex. Do not invent another project’s version namespace.

## Code quality (portable)

`codeQuality.profile` default **standard**: modular units, one-way deps, justified DRY, no god-units, structure in non-trivial FCs. See `CODE_QUALITY` annex. Complements `MAINTAINABILITY` (docs/comments).

## Industrial base (portable)

**Tier A:** threat · secrets · observability  
**Tier B:** reliability · env promotion · backup/DR · perf · API contracts · deps · incidents  
→ `protocols/annex/security/*`. No fake badges (`CI_TRUTH`).

## Roster (from install)

Alfa (Antigravity) seat O · Bravo (Grok) seat R · Charlie (Claude Code) seat O

## Precedence

`Ω break-glass (A0) > signed L/FC > A1 > A2 > A3 > model preference`
<!-- L-HARNESS:END -->
