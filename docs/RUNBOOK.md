# Orchard runbook

Half-Life deploys to **Orchard**, org **YSWS** (`ysws`). Not Vercel, not Coolify.

## One-time setup

1. **Register the OAuth apps before the first deploy.** At `auth.hackclub.com`, redirect URI:

   ```text
   https://<host>/api/auth/callback/hca
   ```

   and at Hackatime, `https://<host>/api/auth/callback/hackatime`.

   At Lapse (Developer Apps), `https://<host>/api/auth/callback/lapse`, with scopes `user:read timelapse:read`; set `LAPSE_CLIENT_ID` and `LAPSE_CLIENT_SECRET`. Every timelapse is recorded on Lapse and picked in the journal, so without this app nobody can finish a journal entry.

   Generic OAuth providers register as first-class social providers in better-auth 1.7, so the callback path is `/api/auth/callback/<providerId>` – **not** an `oauth2`-prefixed one. The URI must match `BETTER_AUTH_URL` exactly: same scheme, no trailing slash.

   **HCB (grant payouts).** Register an application at `https://hcb.hackclub.com/api/v4/oauth/applications` with redirect URI `https://<host>/api/integrations/hcb/callback` and scopes `restricted card_grants:read card_grants:write organizations:read transactions:write`, then set `HCB_ORG_SLUG`, `HCB_CLIENT_ID`, `HCB_CLIENT_SECRET` and `HCB_REDIRECT_URI` to the same URI. To connect, sign in to Half Life as an admin, open `/admin/grants` and press **Connect HCB**, then approve the application while signed in to HCB as an organiser of the paying org. That action starts the flow from an admin-only POST with a `state` and PKCE, so the callback only completes in the browser that started it; opening the HCB authorise URL by hand no longer stores anything. The callback exchanges the code itself and stores the rotating refresh token encrypted in `hcb_credential`; no token is copied by hand, and `HCB_REFRESH_TOKEN` is only needed to seed a headless deployment. Reconnecting from `/admin/grants` replaces the stored credential after a confirmation. Unless the authorising HCB user is also an HCB admin, leave `HCB_VERIFY_GRANT_OWNER=false` – see [BACKEND.md](./BACKEND.md) → HCB configuration.

2. **Confirm GitHub is wired up.** In the Orchard UI at `/user/settings`, check your GitHub account is linked and the Orchard GitHub App is installed on the `hackclub` org. Verify with `list_github_deploy_targets`. If `hackclub` is not listed, `deploy_from_github` fails with a confusing 404 and no amount of retrying helps.

3. **Create the project and database.**

   ```text
   create_project   name: half-life, organizationId: <ysws org uuid>
   create_database  projectId: <id>, name: half-life-db, storageSize: 10Gi,
                    cpuRequestMilli: 500, memoryRequestBytes: 1073741824
   ```

   Note the returned connection string. Storage can be expanded later (`expand_database_storage`); it cannot be shrunk.

4. **Generate secrets** – `openssl rand -base64 32` for each of `BETTER_AUTH_SECRET`, `INTEGRATION_API_KEY`, `EXPORT_API_KEY` and (if you are pulling PII) `PII_ENCRYPTION_KEY`.

   Keep `.env` files on the operator's machine only. Rotate any credential that has ever lived in one before the directory is shared or archived, and delete stale copies such as `.env.old`. If `PULL_HCA_PII=true`, confirm the HCA app has the `address` and `birthdate` scopes enabled – HCA refuses the whole sign-in if a requested scope is missing – and set `PII_ENCRYPTION_KEY`; without the key, PII pulling quietly turns itself off (a `[config]` line at boot says so) and grant rows ship without an address.

5. **Create the R2 bucket**, an API token scoped to it, and a public custom domain. Put that hostname in `NEXT_PUBLIC_UPLOAD_HOST` – `next/image` refuses any host not in `next.config.ts`'s `remotePatterns`, and the failure is a broken image with no console error. A bucket that already holds uploads from before the S3 endpoint lost its bucket segment has objects under `<bucket>/<key>`; `bun scripts/migrate-legacy-uploads.ts --commit` copies them to the root keys the app stores, and `uploads:backfill-urls` then normalises journal URLs that still name the legacy layout.

   The browser also PUTs uploads straight to this bucket with a short-lived presigned URL, so the bucket needs a CORS policy naming the app's origin. Without it every upload quietly falls back to the old path through the origin, where a large reel still 524s:

   ```json
   [
     {
       "AllowedOrigins": ["https://halflife.hackclub.com"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Add it under R2 → the bucket → Settings → CORS Policy, with the production origin (not a wildcard – an empty response to the preflight is what a browser reports as a failed upload). `bun run verify:uploads` preflights a presigned URL from `NEXT_PUBLIC_APP_URL` and says so if the rule is missing or names another origin.

   **The public asset domain needs two headers and a rule, because a presigned PUT cannot bound its own body.** Bun signs the host and expiry, not `Content-Type` or `Content-Length`, so anyone with a URL can PUT an arbitrarily large `text/html` object and never call `/confirm`; nothing in the app deletes an unconfirmed object, because the app cannot tell an abandoned upload from one whose row is still being written. On the asset domain:
   - send `X-Content-Type-Options: nosniff`, so a stored `text/html` cannot be sniffed into something else;
   - send `Content-Disposition: attachment` for any response that is not an image or a video, so an object the server never checked opens as a download rather than as a page under Hack Club's origin;
   - add an R2 lifecycle rule that expires objects under the upload prefixes (or simply objects older than a day that the app never confirmed) so an abandoned upload does not live forever. The app records every confirmed key in `uploaded_object`; anything absent from that table is not referenced by a post, journal, cover or submission.

   Without the headers, a participant can host attacker-authored HTML at an unguessable URL on that host, under Hack Club branding. If the host is a `*.hackclub.com` subdomain, script there can read non-HttpOnly `.hackclub.com` cookies; the app itself is not writable from it, because every write refuses cross-site requests (`src/lib/guards.ts`).

 6. **Deploy.**

   ```text
   deploy_from_github  projectId: <id>, name: half-life-web,
                       githubRepo: hackclub/halflife, branch: main,
                       buildType: dockerfile, port: 3000,
                       env: [ ...every var from .env.example... ]
   ```

   Watch `get_build_logs`. `next.config.ts` runs at build time, so `NEXT_PUBLIC_UPLOAD_HOST` only reaches the image's `next/image` allowlist if the builder passes it as a build arg; runtime env does not (the Dockerfile declares it).

   **`NEXT_PUBLIC_APP_URL` is the public origin, and production needs it.** Set it to `https://<the host people use>` – the same value as `BETTER_AUTH_URL`, and the same value as the `NEXT_PUBLIC_APP_URL` build arg the builder passes. It is the origin in every absolute link the app writes: the QR code a phone opens, the project and review links in a notification, and the banner committed into a maker's repository. `.env.example` leaves it blank on purpose, so a file copied over verbatim leaves production pointing at `localhost`.

   `APP_PUBLIC_HOSTS` names the hosts this deployment answers on (`halflife.hackclub.com` and the `half-life.k.hackclub.dev` ingress by default). The redirect resolver and better-auth's allowed hosts read the same list, so a deployment reached on another name – a second ingress, a vanity domain – needs it here rather than a code change.

   Set `REQUIRE_BASICAUTH=true` plus `BASICAUTH_USERNAME`/`BASICAUTH_PASSWORD` until launch day – the gate now 503s rather than serving if the flag is on and either credential is blank.

   **Changing an env var later: use `add_env_vars`, not `set_env_vars`.** `set_env_vars` replaces the entire set, so anything you leave out is deleted; `add_env_vars` merges. Both restart the deployment.

   `DATABASE_URL` is the only database setting. The Prisma 8 CLI reads it from `prisma.config.ts` and the runtime reads it from the pool in `lib/prisma8.ts` – both off `process.env.DATABASE_URL`. There is no shadow database: Prisma 8 plans migrations from the contract, not by diffing against a live database.

7. **Create the ingress** – `create_ingress` for `half-life.k.hackclub.dev`. Orchard already terminates TLS for that domain, so no `validate_dns` step is needed; a vanity domain later needs `validate_dns` first.

8. **Check health.** `GET https://<host>/api/health` must return `{"ok":true}`. `{"ok":false}` means the database is unreachable or migrations did not run – look for the `[boot]` lines in `get_pod_logs`.

9. **Seed.** `exec_in_pod` → `bun prisma/seed.ts`. Idempotent; it creates the settings row and the starter shop items without overwriting anything an admin changed.

10. **Enable auto-deploy** on `prod` (`enable_auto_deploy`). Only `prod` auto-deploys; `main` does not.

11. **Sign in once** with an address listed in `SUPERADMIN_EMAILS` and confirm `/admin` loads.

12. **Create the jobs** with `orchard job create` from the committed step files in `jobs/steps/` – see `jobs/README.md` for the commands and the crons, and the section below for why they are shaped the way they are. Then run each one by hand (`orchard job run <id> --wait`) and read the response (`orchard job-run logs <run-id>`). Do not wait for the first scheduled fire to find a typo in a URL.

    Pass UUIDs, never names or slugs: `orchard job get <name>` and `--project <slug>` both answer 500 (`project "…" not found by slug or id`). The project and deployment UUIDs are in `jobs/README.md`.

13. **Notifications.** `create_notification_channel` (Slack webhook), then two rules: one for `deploy.failed`, `pod.crashing`, `job.failed`, `db.crashing`, `backup.failed`, and a separate quieter one for the success events so it can be muted independently.

14. **Backups.** `set_database_backup_schedule` daily, then `create_database_backup` once by hand to prove a restore works.

## Scheduled jobs

Orchard jobs of `type: "app"` run a command inside the deployment's own image with its environment, so `INTEGRATION_API_KEY` is already present and never needs duplicating into the job. `type: "script"` does neither – see below.

The step files these jobs were created from are committed in `jobs/steps/`, with the commands and the reasoning in `jobs/README.md`.

| Job | Cron (UTC) | Endpoint | Reached via |
|---|---|---|---|
| `claim-sweep` | `*/5 * * * *` | `POST /api/integrations/claim-sweep` | ingress |
| `hackatime-sync` | `*/15 * * * *` | `POST /api/integrations/hackatime-sync` | ingress |
| `rsvp-drain` | `*/10 * * * *` | `POST /api/integrations/rsvp-drain` | **internal** |
| `telescreen-sync` | `*/10 * * * *` | `POST /api/integrations/telescreen-sync` | **internal** |
| `airtable-retry` | `17 * * * *` | `POST /api/integrations/airtable-retry` | ingress |
| `loops-sync` | `41 * * * *` | `POST /api/integrations/loops-sync` | **internal** |
| `printer-reconcile` | `0 8 * * *` | `POST /api/integrations/printer-reconcile` | ingress |
| `slack-ticket-summary` | `0 9 * * *` | `POST /api/integrations/slack-ticket-summary` | ingress |
| `slack-review-summary` | `0 9 * * *` | `POST /api/integrations/slack-review-summary` | ingress |

"internal" means the ClusterIP, not the vanity domain – see **Cloudflare kills anything over ~100 seconds** below. Everything else goes through the public ingress like a browser would.

Each step is a **JSON array of step objects**, not a job – the CLI models a job as an ordered pipeline of steps, so a lone object is rejected:

```jsonc
[
  {
    "name": "post",
    "type": "app",
    "deploymentId": "<deployment uuid>",
    "timeoutSeconds": 600,
    "retries": 2,
    "command": "curl -fsS --max-time 570 -X POST -H \"Authorization: Bearer $INTEGRATION_API_KEY\" https://<host>/api/integrations/<name>"
  }
]
```

`orchard job create --name <job> --steps <file> --cron '<cron>'` takes that array; the crons and the committed files are in `jobs/`.

Five details that decide whether this works or quietly rots:

- **`type: "app"`, never `type: "script"`.** A `script` step runs in Orchard's own sandbox image, which has no `curl`, and the job dies instantly with `step-1.sh: line 1: curl: command not found`. The sandbox also keeps none of the deployment's environment, so `envVars` on a script step does not rescue it. The app image installs `curl` (see the `Dockerfile`), which is what makes the command work at all.
- **`curl -f`.** Without it, curl exits 0 on a 500 and the job stays green forever while doing nothing. This is the most common way self-hosted cron goes silent.
- **`concurrencyPolicy: "forbid"`**, so a slow sync does not stack up behind itself every fifteen minutes.
- **`--max-time` under `timeoutSeconds`**, so a timeout surfaces as a clean curl failure rather than a killed pod. The route's own `maxDuration` is not a useful upper bound here: these routes declare 300, but on a long-running server Next does not enforce it, so the step's own timeout is what actually applies. See below for why that forces 1800 on two of them.
- **Never put `INTEGRATION_API_KEY` in `envVars`.** An `app` step inherits the deployment environment already; a job that hardcodes it leaks the production key into the job definition and into every log of it.

### The Loops columns (`loops-sync`)

`loops-sync` fills `Loops - halfLifeLastLoginAt`, `Loops - halfLifeLastEntryAt` and the ten week checkboxes on the `Signups` table. Those columns **were not being filled because the sync could not find anybody's row**, not because the dates were wrong – measured on the live base, 1 of 6348 rows has any Loops date set.

Finding the row is a three-key join, tried strongest first:

1. `Half-Life User ID` on the row.
2. The Airtable record id `rsvp-drain` recorded in `RsvpBuffer.airtableRecordId`. An exact mapping, no column required, and the only one that matches on a base without key 1.
3. Email, as a last resort.

**On the live base the join still matches almost nobody – 1 row has any Loops date set.** All twelve Loops columns plus `Half-Life User ID` exist; the column was never the problem. The problem is the landing form wrote straight to Airtable (`recordSignup` in lib/site/signups) without leaving a `RsvpBuffer` entry, so neither key 1 (only the drain stamps it) nor key 2 (only drained rows record one) can reach a landing row – and key 3 fails whenever the address typed on the landing page differs from the one the identity provider later issued, which is the normal case. That is the whole bug. Going forward every direct write remembers its record id in `RsvpBuffer` (`recordDirectSignup`), so the drain stamps key 1 and key 2 covers the rest; rows from before that fix whose emails diverge are not mappable from current data and stay empty – email matches and drained rows are what the backfill fills.

Two consequences worth knowing:

- **Every direct write now remembers its row.** `recordSignup` (lib/site/signups) records the Airtable record id in `RsvpBuffer` (`recordDirectSignup`), so the drain stamps key 1 and key 2 covers the rest. The sync itself also persists the link whenever an email match finds a row with no mapping yet (`relinked` in the result), so the hourly job heals the join on its own – no manual step required.
- **The drain and the sync probe for columns.** Airtable rejects a request naming a column the table lacks for the *whole* request, so both jobs ask which columns exist first and only send those. A renamed or deleted Loops column degrades that column to unwritten rather than failing the run.

Backfilling existing users (mapped rows only – no row is ever created):

1. `bun --conditions=react-server scripts/backfill-loops.ts` – dry run. Reports how many users link to a row by email, how many are already linked, and how many have no Signups row under their current address. Read-only.
2. `bun --conditions=react-server scripts/backfill-loops.ts --commit` – links what step 1 found, then runs the sync for real. Run it where `DATABASE_URL` points at the real database (the Orchard pod, not a dev machine), since the join is between prod users and the live base.
3. Users with no row under their current address stay empty: their landing address differs from the one the identity provider issued, and nothing in current data maps one to the other. The alternative – creating a new row per unmatched user – would subscribe addresses to the Loops list that never signed up, so it is deliberately not done.

A run whose `matched` count is far below `users` sets `degraded: true` in the response and in the `airtable_loops` sync-run row, and logs an error. Look for that flag before trusting a run: a row that is not found is skipped and counted rather than raised, which is exactly how this stayed invisible.

### Review decision emails (the override columns)

The `Loops - halfLifeReviewStatus` and `Loops - halfLifeReviewerNotes` columns on `YSWS Project Submission` are what the review email triggers on. They are not enough on their own: email-tools only forwards a `Loops - …` field when its value **changed** on that row, and the project name and week were written at submit, so a decision on an older project never re-sent them and the contact kept the project from the maker's most recent submission.

Two extra columns on that table fix it:

- `Loops - Override - halfLifeProjectName`
- `Loops - Override - halfLifeProjectWeek`

They must be single-line text fields. `syncReviewDecisionToYsws` (`src/lib/airtable/sync.ts`) writes them in the same patch as the status and note. email-tools recognises the `Loops - Override - ` prefix, maps each onto the same contact property as the normal column, and applies it with its `override` strategy. The value carries a zero-width stamp so a repeated decision on the same project is still a change the poller forwards; it is invisible in the email.

Set them up in this order, or the first poll after the fields appear will do a full resync and write a blank project name to every contact:

1. Pause the Airtable source in the email-tools admin.
2. Create both columns as single-line text.
3. `bun --conditions=react-server scripts/backfill-loops-review-overrides.ts` (dry run), then repeat with `--commit`.
4. Resume the source.

The app skips the columns when they are absent, so a base without them keeps working as before.

### Justification columns

Four columns on `YSWS Project Submission` carry the maker's evidence, which the pipeline merges into `Automation - Unified Justification`:

- `Justification - Submitter Hackatime ID`
- `Justification - Hackatime Project Name(s) + Date Range(s)`
- `Justification - Lapse Links, comma-separated`
- `Justification - Specific Technical Features`

`syncSubmissionToYsws` (`src/lib/airtable/sync.ts`) writes them at submit from `justificationValues` (`src/lib/airtable/justification.ts`). The first three are written only when there is something to write – a maker may have no Hackatime account, linked project or recording, and a blank would erase evidence the base alone holds. `Justification - Specific Technical Features` is not one of them; the decision mirror writes the reviewer's technical-features box there at decision time, and nothing else writes it.

The reviewer fills two separate fields, and they go to two separate columns. The technical features field is the reviewer's account of what the project has that accounts for the hours: it is written alone to `Justification - Specific Technical Features`, verbatim, and a decision without one writes an empty cell. The "Justification notes" field is the reviewer's own note on the decision: it is written to `Justification - Additional Justification`, stored on the review as `SubmissionReview.reason`, cleared when a later decision withdraws the approval, and cleared on a re-submission so the row never quotes a review it no longer holds. A row still in review, or decided by a console reviewer with no reason, leaves it blank. Neither field is written to `Justification - Alternate Tracking Method`.

Rows written before that landed are completed by:

```bash
bun --conditions=react-server scripts/backfill-airtable-justification.ts
bun --conditions=react-server scripts/backfill-airtable-justification.ts --commit
```

It only fills cells that are empty, so a value already on the row is never overwritten. It no longer writes `Justification - Specific Technical Features`: that column carries only the reviewer's technical-features box now (see below), so rows decided under the old behaviour keep their old text until the decision replay rewrites them. Run it where `DATABASE_URL` points at the real database, so the rows that do have a project get the richer text.

### Reviewer columns on the review rows

`Pass 1 reviewer` is a single-line text field on `YSWS Project Submission`. The live mirror fills it from the reviewer's address stored on the review (`reviewerEmail`).

Rows written before the live mirror wrote `Pass 1 reviewer` are filled by:

```bash
bun --conditions=react-server scripts/backfill-airtable-reviewers.ts
bun --conditions=react-server scripts/backfill-airtable-reviewers.ts --commit
```

It only writes that one column, leaves status and notes alone (so it triggers no Loops email), and clears the address on a phase whose current state no longer matches the review that was standing. Run it where `DATABASE_URL` points at the real database.

### Address columns

`Address (Line 1)`, `Address (Line 2)`, `City`, `State / Province`, `ZIP / Postal Code` and `Country` are a snapshot of the maker's shipping address at hand-in, pulled from Hack Club Auth (`lib/hca-profile`). A blank row means HCA held no address at that moment, not that the write failed: HCA's mailing address is optional and is managed at <https://auth.hackclub.com/addresses>. Every decision now refreshes these cells from HCA too, so an address added after hand-in reaches the row on approval. A row still goes out blank when the maker has no address on file, or when their stored address will not decrypt (which points at `PII_ENCRYPTION_KEY`). Each such row leaves an `AIRTABLE_ADDRESS_GAP` audit row (`/admin/audit?action=AIRTABLE_ADDRESS_GAP`) saying which, so the cause is visible without reading the base. A maker with no HCA account is not recorded, because no address can ever arrive for them. Rows written before this change and not decided since stay blank until the row is rewritten (a resubmission or an admin refresh) or backfilled:

```bash
bun --conditions=react-server scripts/backfill-airtable-addresses.ts
bun --conditions=react-server scripts/backfill-airtable-addresses.ts --commit
```

It only fills cells that are empty, so a value already on the row is never overwritten. It looks only at rows that are still missing a required address cell or a name cell, reads the stored PII first, and asks HCA again only when the stored address is incomplete or the maker has no name on file, so a scheduled run does not cost one HCA request per maker. The same run fills `First Name` and `Last Name` where they are blank, split from the maker's name on their account the way the submit path splits it. A name is only stored on a sign-in sync, so a maker with none on file is refreshed with one, which also refreshes their email and verification status. Every row it still cannot fill is listed in a report with the reason; an address HCA never had cannot be backfilled, and those makers have to add one at the link above. Run it where `DATABASE_URL` points at the real database.

### The technical-features column, for the existing rows

`Justification - Specific Technical Features` used to be written at hand-in as the maker's description, parts list and journal log, with the reviewer features added under their own heading at decision time. It now carries only the reviewer's technical-features box, written verbatim. Rows written under the old behaviour still hold the earlier account; the decided rows are brought in line by replaying their standing decisions:

```bash
bun --conditions=react-server scripts/backfill-airtable-review.ts --commit
```

It rewrites each decided row's `Justification - Specific Technical Features` with the reviewer's box alone, or an empty cell where none was recorded. It runs against the live base, so the first pass is worth reading carefully before adding `--commit`.

### Deflation columns

A review may approve fewer hours than the maker's `Hours spent (self reported)`. The approved figure is written to the row so that it matches the decision:

- `Optional - Override Hours Spent` – a number field. For approved rows, the approved hours when they are below the claim, else the claimed (self-reported) hours. Never left blank for an approved submission.
- `Justification - Deflation Justification` – a long text field. The amounts cut plus the reviewer's reason for the cut when one was recorded: the deflation reason the reviewer gave when the decision carries one, else the review's internal note. The note to the maker is not used here – it is written to `Loops - halfLifeReviewerNotes` and emailed, and it often says nothing about the cut.

`syncReviewDecisionToYsws` (`src/lib/airtable/sync.ts`) writes both in the same patch as the status, note, reviewer and Loops overrides, and clears both when a later decision withdraws the approval. The claimed figure is read from the row itself, so the override always replaces the number the base would otherwise pay. The app probes for both columns and skips them when absent.

Rows decided before this landed are filled by:

```bash
bun --conditions=react-server scripts/backfill-airtable-deflation.ts
bun --conditions=react-server scripts/backfill-airtable-deflation.ts --commit
```

It only touches approved rows, reports how many had nothing cut, and leaves a row alone when no frozen approved figure can be found. Run it where `DATABASE_URL` points at the real database.

### Alternate tracking method

`Justification - Alternate Tracking Method` explains the hours when there is no Hackatime id, no Hackatime projects and no Lapse links to follow. The live write fills it at hand-in from the devlog entries (`N devlog entries, Xh claimed`), and an approval keeps those same facts. It deliberately does not carry the reviewer's technical features or audit note: those describe the work and the decision, not how the hours were tracked. The reviewer's technical features go to `Justification - Specific Technical Features`, and the "Justification notes" go to `Justification - Additional Justification`.

The existing justification backfill fills the column where it is empty:

```bash
bun --conditions=react-server scripts/backfill-airtable-justification.ts
bun --conditions=react-server scripts/backfill-airtable-justification.ts --commit
```

It leaves a cell that already holds something alone and writes nothing when the row has Hackatime or Lapse evidence. Run it where `DATABASE_URL` points at the real database.

The app probes for each column and skips it when absent, so a base without them keeps working. A row already carrying the phase is not rewritten, so a poll of unchanged ships costs no Airtable writes.

The retry job's summary reports `reconciledSecondPass` (currently held) and `reconciledSecondPassReturned` (left a second pass for the queue this run), which is the fastest way to see that returns are being observed.

### Cloudflare kills anything over ~100 seconds

`halflife.hackclub.com` sits behind Cloudflare, which caps the proxy read timeout at roughly 100 seconds. `loops-sync` and `rsvp-drain` batch ten Airtable records per request across 6,348 rows and run for minutes – a measured `loops-sync` run took 10m38s – so through the public ingress they return `504` on every attempt no matter how the step is configured. Raising `timeoutSeconds` does not help: the edge has already given up, and the failure looks identical to a dead app (`curl: (22) The requested URL returned error: 504`).

Those two point at the ClusterIP instead, which resolves in-cluster and skips Cloudflare entirely:

```text
http://half-life.ysws-half-life.svc.cluster.local:3000/api/integrations/<name>
```

That is the `internalUrl` on the deployment, and the job's pod sits in the same namespace, so no extra config is needed. It also means `timeoutSeconds` has to be real – those two carry `1800` with `--max-time 1740`, and the runbook's original `600` would have killed a 10-minute sync. If the edge limit is ever raised, or these two routes get faster, they can go back to the ingress like the rest.

The same limit applies to anything else slow behind the vanity domain, including real users on a slow page – these jobs dodged it, and uploads now do too by going straight to R2 (see **Create the R2 bucket** above).

`src/proxy.ts` runs for these too and already excludes `/api/integrations` from basic auth, so `REQUIRE_BASICAUTH` does not block either path – verify that before enabling it, or every job goes red at once.

Most of these routes accept `?dryRun=true` and return what they would have done without writing (`printer-reconcile` writes a run record either way). Use it before trusting a schedule.

## Routine operations

**Deploy** – merge to `prod`; auto-deploy builds and rolls. Only `prod` auto-deploys. `main` is the integration branch and does not deploy, so promote `main` to `prod` with a PR to release.

**Roll back** – `rollback_deployment` reverts the *image*, not the *database*. A release containing a destructive migration is not rollback-safe. Keep migrations additive (add nullable, backfill, drop in a later release) and this never comes up.

**Migration failed at boot** – the pod crashloops and `pod.crashing` fires; `get_pod_logs` has the Prisma error. Fix forward with a new migration. Restore a backup only if data was lost.

**A job went red** – `orchard job runs <id>` then `orchard job-run logs <run-id>`, then `orchard job run <id> --wait` by hand. Reproduce with `?dryRun=true` first.

Triage by the status code in the step log, because they mean different things:

- **`UNAUTHENTICATED` (401)** – wrong or missing key. An `app` step should already be inheriting it, so check the step is not a `script` step.
- **`504`** – not a job problem and not a dead app. Cloudflare timed out at ~100s; see **Cloudflare kills anything over ~100 seconds**.
- **`curl: command not found`** – the step is `type: "script"`. It has to be `type: "app"`.

**Someone sees "That upload took too long"** – there are three causes, and the rest of the message names which one:

- **"went through our server" or "could not reach our storage directly"** – the browser could not PUT straight to R2, so it used the old form route and the edge killed it at ~100s. Run `bun run verify:uploads`: a missing or wrong-origin CORS rule makes every upload take this path, and fixing the rule (see **Create the R2 bucket**) is the real fix. If the CORS check passes, that person's network is blocking the bucket; another network, or a smaller clip, is the workaround.
- **"get the upload ready"** – `/api/upload/presign` or `/api/handoff/presign` timed out before any bytes were sent. That is the origin or the database, not the file or the bucket; check pod and database health, then retry.
- **"check it"** – the bytes landed, but `/api/upload/confirm` or `/api/handoff/confirm` timed out while reading what R2 stored (a picture is hashed in full; a video only gets its header read). Retrying is safe – an image reuses its content-hash key, and a failed confirm leaves at most an orphaned video object. If it repeats, check R2 latency and the confirm route's logs.

**Stop participant writes right now** – flip *Submissions open* off at `/admin/program`. It is a database row with an audit trail, deliberately not an env var: stasis put this in `SUBMISSIONS_CLOSED`, nobody flipped it in the dashboard, and submissions stayed open for two weeks after the event ended. Reviews and the shop stay up.

**Helpers can't close tickets** – both "Mark as helped" buttons fail closed on membership of the private tickets channel (`SLACK_TICKETS_CHANNEL_ID`). If someone in `#half-life-tickets` is refused, read the app logs for `mark_helped`: `unreadable member list … missing_scope (needed groups:read)` means the manifest's `groups:read` scope was never applied – re-import `slack-app-manifest.yml` (Features → App Manifest → Save), reinstall the app to the workspace, and invite the bot into the private tickets channel. `channel_not_found` / `not_in_channel` means the bot itself is not in that channel – invite it. If there is no error line and the clicker is refused, compare the logged channel id against the channel's real id in Slack – the env var may point at a different (e.g. recreated) channel than the one the helpers sit in.

**A grant row never reached Airtable** – `/admin/program` lists them with a retry button, and `/admin/audit?action=AIRTABLE_SYNC_FAILURE` has the errors. The `airtable-retry` job does the same sweep hourly.

**A project was returned before the return-extension existed** – a return now writes a week onto the returned project's `submissionExtensionUntil`, but only on the decision itself, so a project already sitting on "needs changes" from before keeps the old window and its maker may be unable to hand the fix in. `bun --conditions=react-server scripts/backfill-return-extensions.ts` reports every such project (dry run) and `--commit` gives each the same week, `reviews:backfill-return-extensions` being the same thing by name. It skips any project with an extension already running and is safe to re-run. Run it where `DATABASE_URL` points at the real database.

**A user says an approved project paid no coins** – `bun run audit:approved-coins` is read-only and compares every standing approval's frozen coin figure with the ledger. It separates the normal case (a design approved inside its tier's funded block, where those hours buy parts and earn no coins) from a real gap (`SHORT` – the decision says coins were earned but the ledger has less), a zero-hour approval (`ZERO_HOURS`), and a project approved without a standing approval row (`NO_APPROVAL_RECORD`). Start there before adjusting anyone's balance.

**A maker submitted an entry with the wrong hours** – open the maker at `/admin/users/[id]`, expand the project under *Themed projects* and use *Journal hours* → *Correct hours* on the entry. A reason is required, and the audit row (`ADMIN_UPDATE_SESSION_HOURS`, on `/admin/audit`) records the old and new figures. A week that is in review cannot be changed, so wait for the decision. For a decided week the entry's claimed hours change but its frozen hours and coins do not, so the record and the payout disagree until the week is re-reviewed: use *Un-approve* under *Override a decision*, then review the week again.

Runs from before the row was mirrored left it on "Changes Requested" while the phase went back in review. The next return then writes the value the row already holds, and email-tools forwards only changed values – so the maker never hears the real decision. `--heal` reports those phases (dry run) and `--heal --commit` puts their rows back on "Pending Review" and clears the stale note. It touches only phases this script reopened and that are still in review, so a repaired phase that has since been decided is left alone. Run both where `DATABASE_URL` points at the real database.

**Import the pre-season warm-up projects** – `/admin/program` → *Warm-up projects from Airtable* pulls the rows the Fillout form wrote into the `YSWS Project Submission` table (`AIRTABLE_YSWS_TABLE_ID`) into Half Life. It creates an account for any maker who has not signed in yet, files each project on the Warm Up track, records the self-reported hours, and puts the project in the review queue. Safe to re-run: rows already imported, and rows Half Life itself wrote, are skipped. Anything it could not take is listed with its reason. Each row becomes its own project, so a maker who handed the form in more than once gets every project they submitted.

**Scale for a launch spike** – `scale_deployment` to 2-3 replicas; the app is stateless and sessions live in Postgres. Stagger the rollout rather than going from 0 to 3 at once, so several `prisma db migrate` runs are not racing at boot (Prisma's advisory lock handles it, but there is no reason to lean on it).

## Local development

`./dev.sh` starts Postgres in Docker, waits on its healthcheck, emits the Prisma contract, migrates, seeds and runs `next dev`. It is safe to re-run.

The app works with no Airtable, no R2 and no Slack configured – every one of those integrations no-ops with a warning when its credentials are missing.
