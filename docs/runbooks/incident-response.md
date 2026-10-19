# Incident response and rollback — yekora.mx

Scope: the production site `https://yekora.mx`, its deployment pipeline
(`.github/workflows/deploy.yml`) and the credentials that pipeline uses.
Architecture background: ADR 0001 (hosting and deploy) and ADR 0004 (404 document).

## Owner and channel

| Role                                                         | Who                               |
| ------------------------------------------------------------ | --------------------------------- |
| Incident owner, decides and approves every production action | **GrayMan (Ω)**                   |
| Diagnosis, fix, rollback commits                             | Charlie (fullstack), on Ω's order |
| Architecture and post-incident design changes                | Alfa                              |
| Post-incident review and evidence                            | Bravo                             |

Every incident is announced on the H channel (`hPost`). Any action outside the normal signed
flow is logged as `Ω BREAK · motive · scope · return-to-L conditions`. Hosting problems go to
Hostinger support through hPanel.

## Severity scale

SEV-1 is decided by FC 006, truth table T1.2: **SEV-1 ⟺ D ∨ S**, where:

- **D**: the site is down or answers 5xx persistently;
- **S**: a credential or deploy key is leaked or compromised.

| Level     | Meaning             | Examples                                                                                                               | First response                                                |
| --------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **SEV-1** | Critical            | `https://yekora.mx/` down or 5xx for minutes; deploy key, SSH password or a CI secret exposed                          | Immediately: contain (rotate/revoke), restore service, H post |
| **SEV-2** | Severe degradation  | Key pages broken in a language; legal pages missing or wrong; deploy pipeline blocked while a production fix is needed | Same day                                                      |
| **SEV-3** | Partial degradation | One page or element broken; a non-critical check failing (e.g. a flaky E2E)                                            | Next working session                                          |
| **SEV-4** | Minor / cosmetic    | Typos, visual glitches with no functional impact                                                                       | Backlog (K)                                                   |

When D and S are both false, triage between SEV-2 and SEV-4 by user impact.

## First checks (any incident)

1. `https://yekora.mx/version.txt` shows which commit is live.
2. Check the latest run in GitHub Actions (`deploy.yml`) and which job or step failed.
3. Load `https://yekora.mx/` and `https://yekora.mx/en/` in a browser. A wrong path must show
   the branded 404 with status 404.
4. Check hPanel for hosting status and notices.
5. FC 008: `https://apiv1.yekora.mx/health` shows the API's commit (`sha`) and whether MariaDB
   answers (`db: connected`, or `503 degraded` with `db: unreachable`).

## Procedure A — site down or broken after a deploy (rollback)

**RTO ≈ 10 minutes:** one full pipeline run.

1. Find the last good commit: the previous entry in `git log` whose run was green.
2. Revert the bad commit on `main`:
   ```bash
   git revert --no-edit <bad-sha>
   git commit --amend -m "V.<x>.<y>.<z+1>_FC_<n>_Revert_<Description>" \
     -m "Reverts <bad-sha>: <one-line reason>." -m "SemVer: <x>.<y>.<z+1>" -m "FC: <fc-id>"
   git push origin main
   ```
   A revert is a PATCH. It runs the whole pipeline: tests, certification, the A1 probe, the
   deploy and the smoke test.
3. Verify: `version.txt` equals the revert commit's SHA, and `/` and `/en/` answer 200.
4. Post the outcome on H. The fix of the original change returns through a signed FC.

**If GitHub Actions itself is unavailable (break-glass, Ω only):** rebuild the last good commit
locally (`bun run build`), then publish it with the deploy key:

```bash
rsync -avz --delete --exclude='.well-known/' \
  -e "ssh -p 65002 -i ~/.ssh/yekora_deploy -o StrictHostKeyChecking=yes" \
  ./out/ u701509674@82.29.85.192:./
```

Log it as an Ω BREAK. Never upload into a nested `public_html/`: the key's root already is
`public_html`.

## Procedure B — deployment pipeline failing

| Failing step                                 | Meaning                                                                     | Action                                                                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tests, lint, Sonar, E2E, certification       | Production is untouched: the deploy never ran                               | Fix through a normal FC; not an incident unless a production fix is blocked (SEV-2)                                                                  |
| SSH connection: host key verification failed | The server's host key no longer matches `SSH_KNOWN_HOSTS`                   | **Do not** simply replace the secret. Confirm the change with Hostinger first (a mismatch can mean interception). Only then update `SSH_KNOWN_HOSTS` |
| **A1 probe** fails                           | The deploy key opens a shell or can see above `public_html`                 | **SEV-1 (S).** The key is no longer confined, and the account is shared with Archon. Run Procedure C before any further deploy                       |
| rsync                                        | Network or permission error during the upload                               | Re-run the job. A partial upload is fixed by the next complete rsync (`--delete` keeps the folder exact)                                             |
| Smoke test                                   | Production does not serve the deployed commit, or a key URL does not answer | Wait a few minutes for caching, then re-check. If production is broken, run Procedure A                                                              |

## Procedure C — deploy key or credential compromised (SEV-1)

1. **Contain**:
   - In Hostinger, remove the `yekora-deploy-ci` line from `~/.ssh/authorized_keys`, over SSH or
     in hPanel → SSH keys.
   - In GitHub, delete the `SSH_PRIVATE_KEY` secret.
   - If the SSH password may be exposed, change it in hPanel.
2. **Check for tampering**:
   - Compare production against the last good build:
     `rsync -avzn --checksum --delete --exclude='.well-known/' ./out/ <user>@<host>:./`
     (dry run: it lists the files that differ).
   - Ask Ω to check Archon as well, since the account is shared.
3. **Re-key**:
   - Generate a new ed25519 key without a passphrase.
   - Add its public key with the same forced command as before:
     `command="/usr/bin/python3 /home/u701509674/bin/rrsync /home/u701509674/domains/yekora.mx/public_html",restrict ssh-ed25519 …`
   - Store the private key in `SSH_PRIVATE_KEY`.
4. **Verify**: run the pipeline. The A1 probe must pass before rsync runs. Then republish the
   last good commit (Procedure A, step 3).
5. **Other secrets**: `SONAR_TOKEN` is rotated in SonarQube Cloud (My Account → Security) and
   updated in GitHub secrets. TruffleHog runs on every push to catch new leaks.
6. **Record**:
   - H post with the timeline;
   - an entry in the forensic log (F);
   - a post-incident note.

## Procedure D — catalog API down or wrong (FC 008)

The site keeps working without the API: the catalog pages are static HTML built from a snapshot
of the API. Only the next deploy needs it, because the build reads the catalog from the API and
fails (keeping the previous site online) when it cannot.

| Symptom                                    | Action                                                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/health` does not answer, or answers 5xx  | Ω restarts the Node.js app in hPanel (Websites → apiv1.yekora.mx → restart). Then re-check `/health`                                               |
| `/health` 503 with `db: unreachable`       | MariaDB is down or its credentials changed: check hPanel → Databases, then the app's environment variables (`DB_*`). Never paste them in chat or H |
| `/health` shows an older `sha` than `main` | Hostinger did not pull `api-release`. Check that the app tracks branch `api-release`, redeploy it in hPanel, and re-run the `api-release` job      |
| `/v1/exchange-rate` 503                    | No Banxico FIX stored yet (or `BANXICO_TOKEN` missing or revoked). Prices still show in MXN; fix the token in the app's environment                |

**Rollback of the API:** revert the bad commit on `main` (Procedure A). The pipeline publishes the
reverted bundle to `api-release` and the smoke test checks that `/health` reports its SHA. Hostinger
never builds: what runs is always a bundle certified by CI.

## Procedure E — production database (FC 008)

- **Migrations** only run through `db-migrations.yml`: Ω starts the `yekora-db` runner
  (`C:\actions-runner-yekora\run.cmd`), dispatches the workflow with the migration file name and
  approves `production-db`. Every run first takes an encrypted backup (artifact, 7 days).
- **Restore a backup** (Ω only, the key never leaves Ω's password manager):
  1. Download the artifact `backup_pre_<migration>_<time>.sql.gz.enc` from the run.
  2. Decrypt and restore it into a scratch database first, never straight into production:
     `openssl enc -d -aes-256-cbc -pbkdf2 -pass env:DB_BACKUP_ENCRYPTION_KEY -in <file> | gunzip > dump.sql`
  3. Check the row counts, then load it into production from the whitelisted PC.
- **RTO:** measured only locally so far (F1 rehearsal, `scripts/restoreDbBackup.ts`). The production
  measurement is pending (K-12).

## After an incident (SEV-1 and SEV-2)

Within two days, write a short note in the local governance workspace (`protocols/analysis/`):

- timeline;
- impact;
- root cause, with evidence;
- what changed;
- follow-up items, added as cards in K.

Facts first and no blame (L `ARGUMENT_DISCIPLINE`).

## Known limits

- The rollback above has not been rehearsed in production yet. A rehearsal is the evidence that
  turns ISO S06/Q05 from NOT_VERIFIED into PASSED.
- There is no runtime monitoring or alerting yet: the static site has no server logs of its own.
  Detection relies on the post-deploy smoke test and on people noticing. An uptime check is a
  candidate for a future FC.
