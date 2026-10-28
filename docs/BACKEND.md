# The Half Life backend

A handoff. Read this once before changing anything; the deeper reasoning lives in [ARCHITECTURE.md](./ARCHITECTURE.md) (invariants) and [RUNBOOK.md](./RUNBOOK.md) (operating it).

Half Life is a ten-week hardware programme. Participants design five projects and then build all five, journalling as they go; approved work mints coins, and coins buy a 3D printer at the end. The backend's job is to hold that economy honestly.

---

## Shape

Next.js 16 App Router, Postgres via Prisma 8, Cloudflare R2 for media, better-auth against Hack Club Auth. One repo, four worlds:

| Route group | What it is |
| --- | --- |
| `(site)` | The marketing page. Own root layout and stylesheet. |
| `(platform)/(app)` | The logged-in product: trail, projects, shop, feed. |
| `(platform)/(ops)` | Admin and review. Carries `ops.css`, the earlier design system. |
| `(handoff)` | One public page: the phone upload a QR code opens. |

`proxy.ts` redirects `/` to `/dashboard` when a session cookie is present, so a stranger gets the landing page and a participant lands on the trail, which has its own URL. That cookie check is optimistic and decides nothing – `(app)` runs `requireSessionPage()`.

**There are no server actions.** Every write goes through `src/app/api/**`, which means every write has one auditable entry point with a Zod schema on it.

```text
src/lib/config/     every tunable number – tiers, printers, themes, weeks
src/lib/queries/    read paths (one per surface)
src/lib/*.ts        domain: currency, hours, review, shop, feed, handoff, streak
src/lib/schemas/    Zod, one per API area
src/app/api/        every write
prisma/contract.prisma
```

---

## The seam you most need to understand

The trail derives its **entire** shape – how many nodes a week has, where the progress reels fall, which node is live, what is locked and why – from one pure function, `curriculum.checkpointsFor()`, applied to one map of checkpoint states.

`lib/queries/store.ts` builds that map by reading the projects, sessions, posts and submissions that already exist. `lib/store.tsx` hands it to the UI through `useStore()`.

**There is deliberately no checkpoint table.** It would be a second source of truth for "has this week had its idea reel", and the first time the two disagreed the trail would lie to someone about work they had really done.

Reels bind to their node by `Post.checkpointKey`, not by counting posts of a kind: the 5h and 15h reels are both `PROGRESS`, so counting would tick the 15h node the moment the 10h one landed.

---

## Invariants worth protecting

**The ledger is append-only.** `reconcileGrant` reads a running sum and writes the delta, so re-approving something converges instead of double-paying. It sums **by kind** – so a new bucket needs a *new kind*, not the same kind with a different bucket, or the two halves reconcile against each other's totals forever.

**Two pots.** `SPENDABLE` buys anything; `BANKED` is the printer fund and buys a printer only. `spendableFor()` is the only thing that decides which applies.

**Banking is paced by the printer, not the tier.** A tier decides how many of a design week's hours the project itself eats (`fundingHours`); everything above that banks at the rate the chosen machine needs (`goal.bankedHours`). Every tier banks the same for the same printer. `lib/config/printers.ts` is the budget spreadsheet transcribed – the season must land on each price, and `verify:ledger` checks all eight machines.

**Hours have one implementation.** `rollUpHours()` decides what a phase is worth and both the trail and the reviewer call it. Journal and Hackatime hours are additive; timelapse duration is *not* (it is a recording of hours already claimed).

**Uploads store keys, never URLs**, minted at read time so the bucket can move. Keys are `<folder>/<userId>/<uuid>.<ext>` and are **not secrets** – the feed returns a full video URL for every reel. Anywhere a client hands a key back, check `isOwnedKey()`, or a stranger's timelapse becomes evidence for hours nobody worked.

**Nobody reviews their own work**, and a build cannot be approved before its design.

**The submit gate is server-side.** `submitPhase` re-runs `checkRepo` rather than trusting the submit sheet: a missing README, too little text or too few photos, or a missing required file blocks, while the README BOM table is only a warning. The CAD source list accepts editable files from accepted tools only – Tinkercad, OpenSCAD, Blender and STL-only fail – and a starter project still carrying the starter's own description is refused. See `docs/ARCHITECTURE.md`.

---

## Reviewing with Ari

Ari (`ari.hackclub.com`, `@hackclub/ari`) is the review surface. Half Life sends each submitted (project, phase) as a ship and receives the decisions back as signed webhooks; the in-house `/review` console still exists and still works – whichever decision lands first wins, because both go through `finalizeReview` and it refuses an already-resolved submission.

- **`lib/ari.ts`** is the whole integration. `lib/ari-id.ts` holds the two pure helpers (`ariExternalId` / `parseAriExternalId`) so `verify:contracts` can pin the format.
- **One ship per (project, phase).** `external_id` is `<themeProjectId>:design` or `:build`, so design and build get independent decisions. The Airtable row is found by the record id kept in the audit log; when that id is unknown, the write adopts a row matching (email, project name, stage) under an advisory lock, because the table has no Half-Life ID column.
- **Outbound** happens in the submit/unsubmit `after` hooks, like the Airtable write, and no-ops when the `ARI_*` secrets are unset. A failed send logs an `ARI_SYNC_FAILURE` audit row and is replayed by `ari-retry`, or by hand from `/admin/program`.
- **Inbound** is `POST /api/integrations/ari/webhook`, verified with `ARI_WEBHOOK_SECRET`. `ARI_WEBHOOK_SECRET` is **not** the signing secret; the SDK treats them as different credentials.
- **Decisions are applied through `finalizeReview`,** attributed to no Half Life user (`SubmissionReview.reviewerId` is nullable) and with reviewer identity in the audit row. Ari's `approved_hours`/`approved_minutes` become the hours override, so the payout matches what Ari approved.
- **A design approval needs a tier.** Half Life's design approval is also the funding decision, and Ari reviews the work rather than the money, so the tier is the maker's `requestedTier` (falling back to an assigned `tier`). A design approval with neither is logged as `ARI_WEBHOOK_IGNORED` and left for a human rather than invented.
- **Idempotent.** The `delivery_id` is checked first and recorded only after the work succeeds, so Ari's retries are safe and a failed delivery is retried. `review.requeued` undoes the local status and credit and puts the same ship back in front of reviewers; `review.reverted` does the same but leaves the phase on `update_requested`, because the ship is terminal at Ari and only a fresh hand-in can be reviewed. `review.fraud` flags the maker on a failed verdict; `ship.updated` and unknown events are recorded and ignored.
- **A 409 `already_queued` is an answer, not a failure.** Ari refuses to replace an open ship but names the ship it found, so `sendSubmissionToAri` records that id on the hand-in instead of retrying forever. This is the recovery for a create whose response was lost, and it stops a ship Ari already has from being invisible to every local count.
- **The admin ring counts projects, one state each.** `getProjectReviewStatuses` gives every project the single state its card shows (`projectReviewState`: rejected > needs changes > pending > approved) and counts it once, so the ring's total is the number of projects that have been submitted and a project cannot appear in two slices. The ship-level count still exists for the queue: `countAriShips` backs the admin pending figure and `ari-review-counts` mirrors Ari's own board, so the ring and Ari's board answer different questions.
- **A delivery can be lost, so decisions are also pulled.** The webhook is fire-and-forget: a delivery sent while the endpoint was unregistered, misconfigured or briefly unreachable is gone, and the hand-in sits decided at Ari while Half Life still shows it pending – the admin pending figure then reads hundreds of hand-ins more pending than Ari's own board. `reconcileAriDecisions` (`lib/ari.ts`) asks `ari.ships.status` for each open hand-in and applies any standing decision through the same `finalizeReview` the webhook calls; a ship Ari reports as `reverted` is reset from there too, because a lost revert leaves the phase looking pending forever. `ari-retry` runs a bounded pass every hour, and `bun run reviews:backfill-ari` (dry run; `--commit` writes) drains a backlog in one go. `status` carries the decision and nothing else – `id`, `external_id`, `version`, `phase`, `decision` – so a replayed decision has no note to store and is recorded with Ari's generic sentence; the approved hours are likewise reconstructed from Half Life's own roll-up, so check the few approvals rather than trusting them blind. Makers are not notified by a bulk replay by default (`--announce` opts in) – mirror the row afterwards with `airtable:backfill-review`.
- **The phases before a decision are silent, so they are polled.** Ari sends no webhook when a first-pass decision is held for a second pass, nor when a second pass returns it to the queue. The same status pass stores `phase` on `PhaseSubmission.ariStatus` / `ariStatusAt` and mirrors it to `Ari - Review phase`, `Ari - Review phase at` and `Ari - Second pass since` on the Airtable row. `secondPass` and `secondPassReturned` in the job summary count what the poll saw. The confirming organizer is still not exposed: the status response names the phase, not who confirmed or returned the held decision.
- **A pulled decision gets its reviewer's words back from the webhook.** The note an Ari decision carries travels only in the outbound delivery, so a status pass cannot show it. A decision resent from Ari's review screen arrives as an ordinary delivery, and `adoptStatusPlaceholder` (`lib/ari.ts`) rewrites the placeholder it finds instead of refusing it as already-decided. If the status response is extended to return the final review, `bun run reviews:repair-ari` (dry run; `--commit` writes) reads each placeholder back from Ari and rewrites the review row, the audit reason, the reviewer and the project's standing comment in one pass; until then it reports every placeholder as `quiet`.

---

## Payouts

**The Airtable/YSWS pipeline owns payouts.** Approval mints coins and freezes `grantUsd`, and the Design row Half Life writes to `YSWS Project Submission` is what the payout team pays from. Nothing in the app pays a maker automatically.

`/admin/users/[id]` has a **manual fallback**: a "Send grant" action that tops up a maker's HCB card grant directly (`lib/hcb.ts`, `lib/grants.ts`). It is deliberately narrow:

- only on an **approved design**, for the frozen `grantUsd`;
- only for a maker whose **Hack Club identity is verified** – checked fresh with HCA before anything is claimed or sent, and the same rule refuses a positive manual credit adjustment in `/admin/users/[id]` (a clawback is still allowed);
- **once per (user, project, design)** – `HcbGrantTopUp` has a unique key and the row is claimed before HCB is called, so a double-click cannot pay twice;
- **once per card** – the grant hashid is unique, so two projects (or two makers) pointing at the same HCB card cannot each pay it;
- **the card is checked against the maker before it is paid** – the top-up moves the money as it answers, so a grant that belongs to somebody else cannot be caught afterwards;
- a failed attempt records its error and may be retried; one in flight may not;
- it needs `MANAGE_CREDIT`, not `REVIEW_SUBMISSIONS`.

Two things to know before enabling it:

- **It can double-pay alongside the pipeline.** The unique key only prevents a second send *within Half Life*; it knows nothing about what the pipeline has already paid.
- **The HCB v3 API is read-only.** Grants go through the authenticated **v4** API. Set `HCB_ORG_SLUG` plus either a static `HCB_ACCESS_TOKEN` or the refresh-token flow. HCB rotates the refresh token, and an env var cannot be rewritten, so the production path is to persist it (a credentials row or a secret store); with the env flow the token is good for the life of a process.
- **The token has to be able to read the maker's email.** The owner check compares the card's owner with the maker's address, and HCB only renders another account's email to a token that may read it (`pii`, or an admin in their org). A token that cannot will refuse every grant with "HCB would not say who that grant belongs to". `HCB_VERIFY_GRANT_OWNER=false` turns the check off for such a deployment; the payment then goes ahead and the audit row records that nobody checked whose card it was.

---

## Working on it

```bash
./dev.sh                  # Postgres in Docker, migrated, seeded, then next dev
bun run typecheck && bun run lint && bun run build
```

Local scripts need `DATABASE_URL` in `.env` – every `package.json` script assumes it, and without it Prisma silently falls back to a database named after your shell user.

Schema changes: edit `prisma/contract.prisma`, then

```bash
bun run db:generate
bun run db:plan --name <what_changed>
```

Review the planned operations, fill any data-transform placeholders, and apply with `bun run db:migrate`. Verify with `bun run db:verify`. The signed marker in `migrations/app/refs/db.json` records which contract hash the database is at; `prisma db sign` adopts a database whose schema already matches.

Restart `bun run dev` after generating a new contract. The ORM reads `contract.json` when the process starts, so a running dev server keeps the old field list until it restarts and answers with errors such as `Model "ShopOrder" has no field "cancellationReason"` even though the migration is applied.

### The checks

Eleven suites. The DB-backed ones write to whatever `DATABASE_URL` points at and clean up after themselves – **point them at a scratch database, never production.**

| | |
| --- | --- |
| `verify:ledger` | the economy: two pots, and every printer reachable |
| `verify:store` | the database-to-trail mapping |
| `verify:contracts` | client calls match route methods and schemas (no DB needed) |
| `verify:pii` | nothing private reaches a browser; staff surfaces refuse participants |
| `verify:onboarding` | the first checkpoint cannot be skipped |
| `verify:feed` | moderation actually removes things |
| `verify:handoff` | the QR upload token is single-use, through both the direct and form paths |
| `verify:uploads` | R2 round trip, public read, and the direct-upload CORS rule |
| `verify:forge-write` | the forge write path's retries and status classification (no DB) |
| `verify:loops` | the Loops Signups-row join (no network, no DB) |
| `verify:loops-entries` | audit `Loops - halfLifeLastEntryAt` against the devlog rule (read-only unless `--clear`) |

`verify:pii` and `verify:contracts` exist because the compiler cannot see either problem: an RSC serialises whatever it hands a client component into the HTML, so a field nobody renders still ships; and a wrong HTTP method is a 405 that looks identical to "the click did nothing".

---

## Traps that have already bitten

- **`ok()` returns the payload itself – there is no `data` envelope.** Only `fail()` wraps, in `{ error: { code, message } }`. Three clients assumed symmetry and threw on their first call.
- **`tsconfig` has `noUncheckedIndexedAccess`.** Index access is `T | undefined`. Where the real invariant is a fixed arity, write it as a tuple.
- **Prisma 7 moved things.** `migrate diff --from-migrations` needs a shadow database; `db execute` no longer takes `--url` (it reads `prisma.config.ts`).
- **The Docker image does not ship `scripts/`.** `grant-role` and the verify suites cannot run in a pod as-is.
- **`.env.example` comments live above values, not beside them** – a trailing comment gets copy-pasted into a deployment and a 32-character R2 key becomes 59.
- **Asset URLs stored in journals have two possible key layouts.** Before the S3 client stopped putting the bucket name in the path, an object landed at `<bucket>/<key>` and its URL was `<origin>/<bucket>/<key>`. Both that and the current `<origin>/<key>` are valid, so `bun run uploads:backfill-urls` lists the bucket once before rewriting anything rather than assuming one layout. Objects themselves are the other half: `bun run uploads:migrate-legacy` copies every legacy `<bucket>/<key>` object to `<key>` server-side, which is what makes the keys rows already hold resolve. It leaves the legacy copies unless `--delete-legacy` is passed; run the URL backfill first if those are to go, because a journal may still name the legacy URL, and let mirrored projects sync `JOURNAL.md` once more before deleting.
- **Coins are minted at review approval, not when hours are logged.** The trail moves immediately because the node is the entry, not the payment.

---

## Open, and deliberate

- **R2 is public-read.** Anything uploaded is fetchable by URL, by anyone. Reels, journal photos, timelapses.
- **`/explore` publishes journal bodies to every participant.** Written for a reviewer, read by peers.
- **`/admin/feed` is post-only** – no way to unpin or remove an announcement without the moderation route.
- **Deadlines are soft by design.** A late joiner has to be able to finish, so almost nothing on the trail is hard-locked; the one real gate is that a build cannot be approved before its design.
