# Orchard runbook

Half-Life deploys to **Orchard**, org **YSWS** (`ysws`). Not Vercel, not
Coolify.

## One-time setup

1. **Register the OAuth apps before the first deploy.** At
   `auth.hackclub.com`, redirect URI:

   ```
   https://<host>/api/auth/callback/hca
   ```

   and at Hackatime, `https://<host>/api/auth/callback/hackatime`.

   At Lapse (Developer Apps), `https://<host>/api/auth/callback/lapse`, with
   scopes `user:read timelapse:read`; set `LAPSE_CLIENT_ID` and
   `LAPSE_CLIENT_SECRET`. Every timelapse is recorded on Lapse and picked in
   the journal, so without this app nobody can finish a journal entry.

   Generic OAuth providers register as first-class social providers in
   better-auth 1.7, so the callback path is `/api/auth/callback/<providerId>` —
   **not** an `oauth2`-prefixed one. The URI must match `BETTER_AUTH_URL`
   exactly: same scheme, no trailing slash.

2. **Confirm GitHub is wired up.** In the Orchard UI at `/user/settings`, check
   your GitHub account is linked and the Orchard GitHub App is installed on the
   `hackclub` org. Verify with `list_github_deploy_targets`. If `hackclub` is
   not listed, `deploy_from_github` fails with a confusing 404 and no amount of
   retrying helps.

   **Ari (project review).** Create the program at ari.hackclub.com, then set
   `ARI_PROGRAM_ID` and `ARI_SIGNING_SECRET`, register
   `https://<host>/api/integrations/ari/webhook` as its webhook URL, and set
   `ARI_WEBHOOK_SECRET` from that page — a different secret from the signing
   one. Until all three are set, submission sends no-op and the webhook route
   answers 503 rather than trusting an unverified body. Create the `ari-retry`
   job below so a failed send is replayed.

3. **Create the project and database.**

   ```
   create_project   name: half-life, organizationId: <ysws org uuid>
   create_database  projectId: <id>, name: half-life-db, storageSize: 10Gi,
                    cpuRequestMilli: 500, memoryRequestBytes: 1073741824
   ```

   Note the returned connection string. Storage can be expanded later
   (`expand_database_storage`); it cannot be shrunk.

4. **Generate secrets** — `openssl rand -base64 32` for each of
   `BETTER_AUTH_SECRET`, `INTEGRATION_API_KEY`, `EXPORT_API_KEY` and (if you are
   pulling PII) `PII_ENCRYPTION_KEY`.

   Keep `.env` files on the operator's machine only. Rotate any credential that
   has ever lived in one before the directory is shared or archived, and delete
   stale copies such as `.env.old`. If `PULL_HCA_PII=true`, confirm the HCA app
   has the `address` and `birthdate` scopes enabled — HCA refuses the whole
   sign-in if a requested scope is missing — and set `PII_ENCRYPTION_KEY`;
   without the key, PII pulling quietly turns itself off (a `[config]` line at
   boot says so) and grant rows ship without an address.

5. **Create the R2 bucket**, an API token scoped to it, and a public custom
   domain. Put that hostname in `NEXT_PUBLIC_UPLOAD_HOST` — `next/image` refuses
   any host not in `next.config.ts`'s `remotePatterns`, and the failure is a
   broken image with no console error.

6. **Deploy.**

   ```
   deploy_from_github  projectId: <id>, name: half-life-web,
                       githubRepo: hackclub/halflife, branch: main,
                       buildType: dockerfile, port: 3000,
                       env: [ ...every var from .env.example... ]
   ```

   Watch `get_build_logs`. `next.config.ts` runs at build time, so
   `NEXT_PUBLIC_UPLOAD_HOST` only reaches the image's `next/image` allowlist if
   the builder passes it as a build arg; runtime env does not (the Dockerfile
   declares it). `NEXT_PUBLIC_APP_URL` is optional — the browser falls back to
   the page origin and server code to `BETTER_AUTH_URL`.

   Set `REQUIRE_BASICAUTH=true` plus
   `BASICAUTH_USERNAME`/`BASICAUTH_PASSWORD` until launch day — the gate now
   503s rather than serving if the flag is on and either credential is blank.

   **Changing an env var later: use `add_env_vars`, not `set_env_vars`.**
   `set_env_vars` replaces the entire set, so anything you leave out is deleted;
   `add_env_vars` merges. Both restart the deployment.

   `DATABASE_URL` is the only database setting. Prisma 7 dropped the `url =`
   line from `schema.prisma`, so the CLI reads it from `prisma.config.ts` and
   the runtime reads it from the driver adapter in `lib/prisma.ts` — both off
   `process.env.DATABASE_URL`. **Never set `SHADOW_DATABASE_URL` in
   production**: `prisma migrate deploy` refuses to run when the shadow URL
   equals the main one, and the pod crashloops at boot. It exists for the CI
   schema-vs-migrations check and nowhere else.

7. **Create the ingress** — `create_ingress` for `half-life.k.hackclub.dev`.
   Orchard already terminates TLS for that domain, so no `validate_dns` step is
   needed; a vanity domain later needs `validate_dns` first.

8. **Check health.** `GET https://<host>/api/health` must return `{"ok":true}`.
   `{"ok":false}` means the database is unreachable or migrations did not run —
   look for the `[boot]` lines in `get_pod_logs`.

9. **Seed.** `exec_in_pod` → `pnpm db:seed`. Idempotent; it creates the settings
   row and the starter shop items without overwriting anything an admin changed.

10. **Enable auto-deploy** on `main` (`enable_auto_deploy`).

11. **Sign in once** with an address listed in `SUPERADMIN_EMAILS` and confirm
    `/admin` loads.

12. **Create the jobs** (see below), then `run_job` each one immediately and
    read `get_job_run_logs`. Do not wait for the first scheduled fire to find a
    typo in a URL.

13. **Notifications.** `create_notification_channel` (Slack webhook), then two
    rules: one for `deploy.failed`, `pod.crashing`, `job.failed`,
    `db.crashing`, `backup.failed`, and a separate quieter one for the success
    events so it can be muted independently.

14. **Backups.** `set_database_backup_schedule` daily, then
    `create_database_backup` once by hand to prove a restore works.

## Scheduled jobs

Orchard jobs of `type: "app"` run a command inside the deployment's own image
with its environment, so `INTEGRATION_API_KEY` is already present and never
needs duplicating into the job.

| Job | Cron (UTC) | Endpoint |
|---|---|---|
| `hackatime-sync` | `*/15 * * * *` | `POST /api/integrations/hackatime-sync` |
| `airtable-retry` | `17 * * * *` | `POST /api/integrations/airtable-retry` |
| `ari-retry` | `23 * * * *` | `POST /api/integrations/ari-retry` |
| `rsvp-drain` | `*/10 * * * *` | `POST /api/integrations/rsvp-drain` |
| `claim-sweep` | `*/5 * * * *` | `POST /api/integrations/claim-sweep` |
| `printer-reconcile` | `0 8 * * *` | `POST /api/integrations/printer-reconcile` |

Each step:

```jsonc
{
  "type": "app",
  "name": "post",
  "deploymentId": "<deployment uuid>",
  "timeoutSeconds": 600,
  "retries": 2,
  "command": "curl -fsS --max-time 570 -X POST -H \"Authorization: Bearer $INTEGRATION_API_KEY\" https://<host>/api/integrations/<name>"
}
```

Three details that decide whether this works or quietly rots:

- **`curl -f`.** Without it, curl exits 0 on a 500 and the job stays green
  forever while doing nothing. This is the most common way self-hosted cron goes
  silent.
- **`concurrencyPolicy: "forbid"`**, so a slow sync does not stack up behind
  itself every fifteen minutes.
- **`--max-time` under `timeoutSeconds`**, and the route's `maxDuration` under
  that, so a timeout surfaces as a clean curl failure rather than a killed pod.

The jobs hit the public ingress, and `src/proxy.ts` already excludes
`/api/integrations` from basic auth — verify that before enabling
`REQUIRE_BASICAUTH`, or every job goes red at once.

Every one of these routes accepts `?dryRun=true` and returns what it would have
done without writing. Use it before trusting a schedule.

## Routine operations

**Deploy** — merge to `main`; auto-deploy builds and rolls.

**Roll back** — `rollback_deployment` reverts the *image*, not the *database*. A
release containing a destructive migration is not rollback-safe. Keep migrations
additive (add nullable, backfill, drop in a later release) and this never comes
up.

**Migration failed at boot** — the pod crashloops and `pod.crashing` fires;
`get_pod_logs` has the Prisma error. Fix forward with a new migration. Restore a
backup only if data was lost.

**A job went red** — `list_job_runs` → `get_job_run_logs`, then `run_job` by
hand. Reproduce with `?dryRun=true` first.

**Stop participant writes right now** — flip *Submissions open* off at
`/admin/program`. It is a database row with an audit trail, deliberately not an
env var: stasis put this in `SUBMISSIONS_CLOSED`, nobody flipped it in the
dashboard, and submissions stayed open for two weeks after the event ended.
Reviews and the shop stay up.

**A grant row never reached Airtable** — `/admin/program` lists them with a
retry button, and `/admin/audit?action=AIRTABLE_SYNC_FAILURE` has the errors.
The `airtable-retry` job does the same sweep hourly.

**Scale for a launch spike** — `scale_deployment` to 2–3 replicas; the app is
stateless and sessions live in Postgres. Stagger the rollout rather than going
from 0 to 3 at once, so several `prisma migrate deploy` runs are not racing at
boot (Prisma's advisory lock handles it, but there is no reason to lean on it).

## Local development

`./dev.sh` starts Postgres in Docker, waits on its healthcheck, generates the
Prisma client, migrates, seeds and runs `next dev`. It is safe to re-run.

The app works with no Airtable, no R2 and no Slack configured — every one of
those integrations no-ops with a warning when its credentials are missing.
