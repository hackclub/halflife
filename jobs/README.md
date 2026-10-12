# Orchard jobs

Step definitions for the eight scheduled jobs, plus the `orchard job` commands
that create them. `docs/RUNBOOK.md` has the jobs table; this directory is what
actually recreates them.

Every job is a single `app` step pointed at the Half-Life deployment, so the
command runs inside the app image with the deployment's own environment.
`INTEGRATION_API_KEY` is already there – no job duplicates it.

## Create

```sh
PROJECT=e3912dc6-35b4-47c5-ba46-24555dafc213   # Half-Life

orchard job create --project "$PROJECT" --name hackatime-sync \
  --steps jobs/steps/hackatime-sync.json --cron '*/15 * * * *' \
  --concurrency forbid -y
```

Repeat per job with the cron from the table below. To change an existing job's
schedule or name use `orchard job update <id> --cron …`; to change what it runs
use `orchard job steps set <id> --steps jobs/steps/<name>.json`, which replaces
the step list and leaves the run history alone.

| Job | Cron (UTC) | Target |
|---|---|---|
| `claim-sweep` | `*/5 * * * *` | public ingress |
| `rsvp-drain` | `*/10 * * * *` | cluster-internal |
| `hackatime-sync` | `*/15 * * * *` | public ingress |
| `airtable-retry` | `17 * * * *` | public ingress |
| `ari-retry` | `23 * * * *` | public ingress |
| `loops-sync` | `41 * * * *` | cluster-internal |
| `printer-reconcile` | `0 8 * * *` | public ingress |
| `slack-ticket-summary` | `0 9 * * *` | public ingress |

## Three things that decide whether this works

**`type: "app"`, never `type: "script"`.** A `script` step runs in Orchard's own
sandbox image, which has no `curl`:

```
/orchard/scripts/step-1.sh: line 1: curl: command not found
```

That sandbox keeps no deployment environment either, so `envVars` on a script
step is not a substitute for an app step. The app image installs `curl`
(`Dockerfile`, `apk add --no-cache curl`), which is what makes the command work.

**Never put `INTEGRATION_API_KEY` in `envVars`.** An app step inherits the
deployment environment already. A job that hardcodes it leaks the production key
into the job definition and into every log of it.

**`curl -f`.** Without it curl exits 0 on a 500 and the job stays green forever
while doing nothing.

## Why two jobs use the cluster-internal URL

`loops-sync` and `rsvp-drain` talk to the Airtable base in batches of ten
records across ~6,350 rows, so they run for minutes. Cloudflare sits in front of
`halflife.hackclub.com` and caps the proxy read timeout at about 100 seconds, so
a request through the public ingress comes back `504` no matter how the step is
configured – the route's own `maxDuration` of 300s is already past what the edge
will wait for.

Those two point at `half-life.ysws-half-life.svc.cluster.local:3000` instead,
which resolves to the ClusterIP and skips Cloudflare entirely. The app step's pod
is in the same namespace, so it reaches the service directly. `src/proxy.ts`
still runs, and `/api/integrations` is already excluded from basic auth there, so
`REQUIRE_BASICAUTH` does not get in the way.

All eight routes declare `maxDuration = 300`. On a long-running server Next does
not enforce that, so a route that overruns it keeps going and the step's own
timeout is what finally applies – which is why the two internal jobs carry
`timeoutSeconds: 1800` and `--max-time 1740` rather than the 600 the rest use. A
measured `loops-sync` run took 10m38s. The runbook's suggested `timeoutSeconds:
600` would have killed it. If the Cloudflare limit is ever raised, or these two
routes get faster, they can go back to the public ingress like the rest.

## Verifying a change

`orchard job run <id> --wait -y`, then `orchard job-run logs <run-id>` for the
response body. `orchard job list` shows the next fire time, which is the quickest
way to confirm a cron parsed the way you meant it to.

Do not wait for the first scheduled fire to discover a typo. Most routes accept
`?dryRun=true` and report what they would have written without writing it
(`printer-reconcile` writes its run record either way).

## CLI quirk

`orchard job get <name>` and `--project <slug>` both return a 500
(`project "…" not found by slug or id`). Pass UUIDs, not names or slugs. The
UUIDs in this directory are the ones these jobs were created against.