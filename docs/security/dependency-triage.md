# Atención de avisos de seguridad en dependencias

FC 016 (K-32) · Modelo de Archon (FC220 y FC221), adoptado por decisión de GrayMan el 2026-10-26, después de que el gate de dependencias frenó el deploy `40388948104`.

FC 036 (K-40) · «Siempre en cero», por orden de GrayMan (2026-11-01, 252_AN): **toda severidad bloquea** (crítica, alta, moderada, baja e info), la auditoría diaria **corrige sola los parches** y **cierra sola** su Issue cuando vuelve a cero.

## 1. De dónde llega un aviso

| Fuente                                                           | Cuándo                                                                                                      | Qué hace                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auditoría diaria (`.github/workflows/dependency-audit-cron.yml`) | 06:00 UTC todos los días, o a mano (`workflow_dispatch`)                                                    | Corre `bun scripts/dependencyAuditGate.ts`. Si hay cualquier aviso (o uno de severidad desconocida), falla, abre o comenta el Issue «Aviso de seguridad en dependencias (auditoría diaria)» con la etiqueta `security` (GitHub avisa por correo a GrayMan) y el job `autofix` propone los parches (§7). En cero, cierra el Issue. |
| CI de producto (`deploy.yml`, paso «Security Audit», shard 1)    | En cada push o PR a `main`                                                                                  | Mismo gate. Bloquea el despliegue mientras haya cualquier aviso sin excepción vigente.                                                                                                                                                                                                                                            |
| Dependabot (`.github/dependabot.yml`)                            | Lunes 06:00 (Ciudad de México) y, si las actualizaciones de seguridad están activas, al publicarse un aviso | Abre PR agrupados: `dev-dependencies` (minor y patch) y `production-patches` (patch). Nunca propone saltos de versión mayor. Ningún PR se integra sin el CI completo en verde.                                                                                                                                                    |

## 2. Reloj de atención

El reloj corre desde que se abre o se comenta el Issue `security`.

| Severidad       | Triage y plan      | Cierre esperado                              |
| --------------- | ------------------ | -------------------------------------------- |
| Crítica         | ≤ 24 horas         | En el siguiente despliegue posible           |
| Alta            | ≤ 72 horas         | Antes de que bloquee una entrega de producto |
| Moderada o baja | ≤ 7 días naturales | En la siguiente ventana de mantenimiento     |

## 3. Pasos

1. **Transcribir.** Charlie copia el aviso al canal H en su siguiente acuse: paquete, versión, identificador GHSA, severidad y rango afectado.
2. **Analizar la explotabilidad real.** ¿El paquete corre en producción o solo en desarrollo? ¿Se alcanza el código vulnerable desde una entrada externa? En Yekora el sitio es export estático servido por Apache (no hay servidor de Next en producción) y la API es Fastify en Hostinger, con cuerpos limitados por `bodyLimit`. Se reporta con etiquetas `[FACT]` / `[INFER]` en un análisis.
3. **Elegir la corrección de fondo**, en este orden:
   1. versión corregida dentro de la misma versión mayor (como `next` 15.5.27 → 15.5.28);
   2. migración de versión mayor cuando la línea actual no tiene parche (como `zod` 3 → 4 en FC 016);
   3. reemplazo del paquete.

   Una excepción en `ACCEPTED_EXCEPTIONS` de `scripts/dependencyAuditGate.ts` no es una corrección. Solo procede con FC firmado, dictamen R, justificación de no explotabilidad y fecha de revisión de 90 días como máximo, y nunca como atajo para destrabar una entrega. Tampoco cuentan los subpaths de compatibilidad (`zod/v3`): cambian la versión del paquete pero conservan el código vulnerable.

4. **Contrato.** Alfa redacta el FC; Bravo dictamina; GrayMan firma. Sin firma no hay código.
5. **Cierre.** Despliegue con el CI en verde, el gate sin avisos de ninguna severidad y Sonar sin hallazgos. El Issue no se cierra a mano: lo cierra la auditoría diaria cuando vuelve a cero, citando el commit y la ejecución, y se registra en H.

## 4. PR de Dependabot

- Los revisa Charlie (O): diff de `bun.lock`, notas de la versión y CI completo en verde.
- Los integra GrayMan, a mano. Dependabot no fusiona por su cuenta.
- Un PR con el CI en rojo no se integra: se analiza como cualquier regresión.
- Un salto de versión mayor nunca llega por Dependabot (`ignore` de `version-update:semver-major`): se decide con su propio FC.

## 5. Configuración que hace GrayMan en GitHub (una sola vez)

Los PR de Dependabot no reciben los secretos normales del repositorio, solo los de la sección «Dependabot». Sin `SONAR_TOKEN` ahí, el job de Sonar de esos PR falla.

1. **Settings → Code security** (o «Advanced Security»): activar **Dependabot alerts** y **Dependabot security updates**.
2. **Settings → Secrets and variables → Dependabot → New repository secret**: nombre `SONAR_TOKEN`, el mismo valor que el secreto de Actions con ese nombre. Se hace **antes del primer lunes** después de integrar `dependabot.yml`.
3. Si `deploy.yml` llega a usar otro secreto en los jobs que corren en `pull_request`, se da de alta igual en la sección Dependabot.

Charlie guía estos pasos uno por uno cuando llega el momento. Ningún valor de secreto pasa por el chat.

## 6. Verificación automática

- `scripts/checkPipelineIntegrity.ts` (A08, en el CI de producto) exige que `dependency-audit-cron.yml` corra en `ubuntu-24.04`, nunca en self-hosted, y que toda acción esté fijada por un SHA de 40 caracteres. Las reglas viven en `scripts/lib/workflowGuards.ts`, con su prueba.
- `scripts/dependencyAuditGate.ts` es el mismo gate en el CI, en la auditoría diaria y en la máquina de cualquier raptor.
- FC 036: la misma regla A08 exige que el Issue se cierre solo con la auditoría en cero (`if: success()`), que el job `autofix` corra solo tras una auditoría fallida y sin conservar el token del repositorio, que el auto-merge dependa del check «🔱 Yekora Global Certification», que ningún PR se integre sin `--auto` y que el único secreto del workflow sea `SECURITY_AUTOFIX_TOKEN`.

## 7. Corrección automática (FC 036, opción a de GrayMan)

- **Qué corrige solo:** cada versión bloqueada por un aviso se sube a la menor versión publicada **de la misma major y minor** que ningún aviso cubre (un parche), y solo si declara las mismas dependencias. Se reescribe esa entrada de `bun.lock` (versión e integridad) y nada más (`scripts/securityAutoFix.ts`).
- **Qué nunca corrige solo:** un salto minor o major, o un parche que trae dependencias nuevas. Quedan listados en el Issue para GrayMan, que decide con FC.
- **Cómo se integra:** el job abre un PR `security/auto-fix-<fecha>` que corre el CI completo. Se integra solo (auto-merge) cuando la certificación global sale en verde. Si `main` no exige ese check, el auto-merge **no se activa** y GrayMan integra a mano: sin el check, GitHub integraría al instante, antes de cualquier CI.
- **Configuración que hace GrayMan en GitHub (una sola vez):**
  1. **Token `SECURITY_AUTOFIX_TOKEN`** (Settings → Secrets and variables → Actions): token _fine-grained_ solo para este repositorio, con **Contents: Read and write** y **Pull requests: Read and write**, vencimiento de 90 días como máximo (se rota al vencer). Un PR empujado con el token propio de Actions no dispara el CI; por eso hace falta.
  2. **Settings → General → Pull Requests:** activar **Allow auto-merge**.
  3. **Settings → Branches → regla para `main`:** exigir el status check **🔱 Yekora Global Certification** antes de integrar. GrayMan, como administrador, sigue empujando directo a `main`.
