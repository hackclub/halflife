# Pre-launch audit 2 — 2026-09-29

A third pass over the repository, looking for security issues, broken features
and missing implementations before the platform opens. It complements
[LAUNCH_FIXES.md](./LAUNCH_FIXES.md) (the launch review — all items done) and
[PRELAUNCH_AUDIT.md](./PRELAUNCH_AUDIT.md) (the 2026-09-28 audit — all
thirty-eight code items done). Items those passes already settled are not
repeated; where a fix turned out to be incomplete, the residual hole is marked
`[tracked-incomplete]` and the original item is named.

Method: direct reading of the source, plus six parallel audit passes over the
API and guards, the money/hours/review/shop logic, integrations and uploads,
the frontend, the docs against the code, and the deploy/schema configuration.
Every finding below was confirmed in source by the pass that found it, and the
money and authorization findings were re-verified independently. The prior
fixes each pass touched were re-checked as landed. At the time of writing
`pnpm typecheck`, `pnpm lint`, `pnpm build` and `pnpm verify:contracts` all
pass; the DB-backed verify suites were not run (no database was up).

Legend: **BLOCKER** — launch is damaged without it · **HIGH** · **MED** · **LOW**

## Status — two blockers fixed, seven high, twenty-three medium, and a cleanup tail

**Fixed since this pass:** #1 (`d746d6f`) and #2 (`2da57fa`) — the two launch
blockers.

The earlier audits' money fixes are real, and the two residual holes this pass
found in them are now closed. Everything else is correctness, missing operator
surface, or cleanup. No new authorization bypass, injection or
webhook-verification gap was found.

| # | Severity | Item | Area |
| --- | --- | --- | --- |
| 1 | BLOCKER | HCB reconcile reads an unreadable payload as `absent`, so a retry re-sends | money |
| 2 | BLOCKER | Two concurrent first Airtable writes still create duplicate payout rows | integrations |
| 3 | HIGH | A renamed/deleted Hackatime project reads as a fresh zero | money |
| 4 | HIGH | A build can be approved after its design is un-approved mid-decision | money |
| 5 | HIGH | Handoff upload buffers the whole body before auth or size checks | security |
| 6 | HIGH | `pnpm db:seed` cannot run in the runtime image; a fresh deploy seeds no shop | ops |
| 7 | HIGH | `import/.env` (a live-looking DB credential) is in the Docker build context | secrets |
| 8 | HIGH | Printer awards cannot be fulfilled, tracked or revoked from the product | missing feature |
| 9 | HIGH | Reel/comment moderation exists in the library but is unreachable for staff | missing feature |

---

## 1. Launch blockers

- [x] **1. HCB reconciliation fails open: an unreadable disbursement payload
      reads as "nothing landed" and a retry pays again.** **BLOCKER (money)**
      `[tracked-incomplete]` — PRELAUNCH_AUDIT.md #7 · fixed `d746d6f`
  - `src/lib/hcb.ts:139-140` — `if (!Array.isArray(data.disbursements)) return []`.
    `reconcileDisbursement` (`src/lib/hcb.ts:163-183`) then sees an empty list
    and returns `{ kind: "absent" }`, which `sendGrant` treats as licence to
    re-send (`src/lib/grants.ts:103-148`). `grants.ts:105` says a grant that
    cannot be read "fails closed rather than guessing"; it does not.
  - This is the exact failure item 7 set out to close: a top-up whose response
    timed out *after* HCB applied it, retried after the abandoned-attempt
    window. If HCB's `GET` returns a 200 with an envelope, a renamed field, or
    a string `amount_cents`, every row maps to `amountCents: null`, nothing
    matches, and the retry pays twice.
  - Fix: parse strictly and fail closed — anything that is not an array of
    rows with a numeric `amount_cents` (and, where present, a parseable
    `created_at`) must return `{ kind: "ambiguous" }`. Only "every row parsed
    and none matches" may send.

- [x] **2. Two concurrent first Airtable writes can still create duplicate
      payout rows.** **BLOCKER (payout sink)** `[tracked-incomplete]` —
      PRELAUNCH_AUDIT.md #8 · fixed `2da57fa`
  - The fix landed an adopt-existing lookup, but it is still read-then-write
    with no lock and no Airtable upsert key: `src/lib/airtable/ysws.ts:137-146`
    (`findExistingRow` matches Email + Project name + stage, `:69-101`), then
    `send()` POSTs a new row (`:121-133`).
  - Scenario: a submit's `after` hook spends seconds in `syncHcaProfile` +
    `findRepoFile` before writing. At the same moment the hourly
    `airtable-retry` job lists the phase (no `AIRTABLE_SYNC_SUCCESS` row yet)
    and syncs it too. Both read `lastRecordId() === null`, both find no
    existing row, both POST — two "Pending Review" rows reach reviewers and the
    payout team. Same shape for the admin Retry button racing the job.
  - Fix: a real idempotency key — add the `Half-Life ID` + `Stage` fields and
    use Airtable's `performUpsert`, as `docs/ARCHITECTURE.md:160` already
    promises — or serialize creates per (project, phase) with an advisory lock.

## 2. High

- [ ] **3. A Hackatime project that has been renamed or deleted reads as a
      fresh zero, bypassing the staleness guard.** **HIGH (money,
      silent-underpay)**
  - `src/lib/hackatime.ts:36-37` —
    `const match = body.data?.projects?.find((p) => p.name === project); return { seconds: match?.total_seconds ?? 0, stale: false }`.
    A missing project (or missing `data.projects`) is indistinguishable from a
    project with genuinely zero tracked time. `getHoursBreakdown`'s live path
    treats that as authoritative and overwrites `cachedSeconds` with the zero
    (`src/lib/hours.ts:99-110`), so `finalizeReview` never raises
    `HACKATIME_STALE` (`src/lib/review.ts:169-181`).
  - Scenario: a maker links `firmware` (12h cached), renames it to
    `firmware-v2`, and the reviewer approves: 0 Hackatime hours paid, cache
    wiped, no warning. Link-time validation has the same hole
    (`src/app/api/projects/[id]/hackatime/route.ts:92-102`).
  - Fix: return `{ seconds: 0, stale: true, error: "project not found" }` when
    the name is absent from a successfully fetched list ("present with 0s" is
    the only live zero), and validate the name against `listUserProjects` when
    linking.

- [ ] **4. A build approval can commit after its design is un-approved during
      the decision.** **HIGH (ordering invariant)**
  - `src/lib/review.ts:154-156` checks `designStatus === approved` *before* the
    transaction; the transaction (`:216-237`) re-reads only the submission and
    the claim. `getHoursBreakdown(..., { live: true })` (`:169`) can spend
    seconds per Hackatime link before the transaction opens, and
    `unapprovePhase` (`:437-536`) takes the same `lockUserCredit`, flips the
    design to `update_requested` and zeroes its coins.
  - Interleaving: reviewer reads design approved → admin un-approves the design
    → the build decision reaches its transaction with no re-check and mints
    `BUILD_BANKED_HOURS`, `BUILD_HOURS` and the completion bonus with
    `buildStatus = approved`. (The printer award does not fire —
    `ensurePrinterAward` re-queries inside the transaction,
    `src/lib/printer.ts:55-65`.) A stale `tier`/`grantUsd` can freeze the same
    way on a design decision.
  - Fix: after `lockUserCredit` inside the transaction, re-read the project and
    re-check `designStatus` (taking `tier`/`grantUsd` from that row), exactly as
    the claim is re-read.

- [ ] **5. The unauthenticated handoff upload buffers the whole request body
      before any token or size check.** **HIGH (DoS)**
  - `src/app/api/handoff/upload/route.ts:25-29` calls `await req.formData()`
    before reading the token; the size check lives later, in
    `src/lib/handoff.ts:135-139`. The route is deliberately unauthenticated,
    excluded from the basic-auth gate (`src/proxy.ts:114-119`) and has no rate
    limit, so `curl -F file=@10gb` to `/api/handoff/upload` is buffered in
    memory with no valid token. Impact depends on the ingress's request-body
    cap, which the repo does not define.
  - Fix: reject/stream by `Content-Length` (and a hard per-request cap) before
    `formData()`, or require the token in the URL and check it first.

- [ ] **6. `pnpm db:seed` — RUNBOOK launch step — cannot run in the runtime
      image, so a fresh deploy seeds no shop.** **HIGH (ops)**
  - `docs/RUNBOOK.md:109` tells the operator to run `pnpm db:seed` in the pod.
    `prisma/seed.ts:5` imports `../src/lib/config/printers`, but the runner
    copies only `public`, `.next/standalone`, `.next/static`, `node_modules`,
    `src/app/generated`, `prisma` and `prisma.config.ts` (`Dockerfile:65-78`);
    `src/lib/**` is absent. The failure was reproduced in a simulated runner
    root (`Cannot find module '../src/lib/config/printers'`).
  - `getProgramSettings()` lazily creates the settings row
    (`src/lib/program.ts:19-29`), so the app still boots — but the shop is empty
    (no printers, no upgrades) until someone seeds it another way. CI runs
    `pnpm db:seed` from the full checkout, so it stays green.
  - Fix: copy `src/lib/config` into the runner (or make `seed.ts`
    self-contained), and add a docker-build + seed smoke check to CI.

- [ ] **7. `import/.env` — a live-looking database credential — is in the
      Docker build context.** **HIGH (secrets)**
  - `import/.env:1` holds a `DB_URL` with a 50-character password. The repo
    `.dockerignore` has `.env*` (line 14) and `data` (line 18), but no `import`
    entry; Docker matches `.env*` against the root path only, not
    `import/.env`, which is not excluded. `Dockerfile:32` then does `COPY . .`
    in the builder stage, so the credential is uploaded to the build daemon and
    retained in builder layers / BuildKit cache (it does not reach the runner
    image). PRELAUNCH_AUDIT.md §2 item 15 already lists `import/.env` as
    holding live-looking credentials; item 6a8edb8 excluded only its sibling
    `data/`.
  - Fix: add `import` (or `**/.env*`) to `.dockerignore`, and rotate that
    credential.

- [ ] **8. Printer awards are schema-only: nothing can lock an address, pack,
      ship, deliver or revoke a printer.** **HIGH (missing feature)**
  - `PrinterAwardStatus` (`ADDRESS_LOCKED … REVOKED`) and the
    `PRINTER_QUALIFIED` / `PRINTER_STATUS_CHANGE` / `PRINTER_REVOKED` audit
    actions exist (`prisma/schema.prisma:200-207, 270-273`), and participants
    are promised a shipped printer (`src/lib/data.ts:44`), but the only writer
    is award creation — `ensurePrinterAward`, called from
    `src/lib/review.ts:383`. No route, admin page or UI writes the status,
    address, tracking or `revokedAt`; `/admin/fulfillment` covers shop orders
    only. After week 10 the grand prize needs hand-written SQL.
  - Fix: a printer section on `/admin/fulfillment` (or `/admin/printers`)
    writing status, address lock, tracking and revoke with the three audit
    actions; extend `FULFILLER` if that is the operator.

- [ ] **9. Reel and comment moderation exists in the library but is
      unreachable for staff.** **HIGH (safety; audience is 13–18)**
  - `hidePost`/`restorePost`/`hideComment` are implemented
    (`src/lib/feed.ts:433-466`), but nothing calls
    `src/app/api/admin/posts/[id]/moderate/route.ts` (grep: only the route
    file), `hideComment` has no route at all, and `/admin/feed` is a composer
    only (`src/app/(platform)/(ops)/admin/feed/page.tsx`). `MANAGE_FEED`
    promises "hide reels or comments" (`src/lib/permissions.ts:24-31`).
    `verify:feed` passes because it calls the library directly.
  - Fix: add a moderation list/action to `/admin/feed` (hide/restore a post,
    hide a comment) and a `POST/DELETE /api/admin/comments/[id]` route.

## 3. Medium

- [ ] **10. HCB's access token is cached for the life of the process.**
      `src/lib/hcb.ts:36-40, 61-70` — `cachedToken` never expires, `expires_in`
      is ignored, and nothing invalidates it on a 401. When the OAuth token
      lapses, every HCB call (top-up, reconcile, memo) 401s until redeploy and
      retries cannot reconcile. Fix: store the expiry, refresh with a margin,
      and clear + retry once on 401.

- [ ] **11. A design grant can be sent after the design is un-approved.**
      `src/lib/grants.ts:67-75` checks approval once, before the unique-row
      claim; the 20-second HCB call (`:151-156`) takes no lock and re-reads
      nothing. An `unapprovePhase` (or Ari revert) in that window sends money
      while the credit reconciles to zero, and the row's `sentAt` blocks a
      later re-approval from sending. Fix: re-read/re-claim immediately before
      `topUpCardGrant`; refuse or flag in-flight rows on un-approve.

- [ ] **12. `backfillAnalytics` re-adds `HACKATIME_TRACKED` hours.**
      `[tracked-incomplete]` — PRELAUNCH_AUDIT.md #27.
      `src/lib/analytics.ts:125-135` filters tracked sessions, but the
      backfill's query (`:185-189`) and sum (`:253-259`) do not, and omit the
      project `deletedAt` filter `activeDaysDesc` uses. The function is
      documented as safe to re-run; running it inflates `UserWeek.hours` so the
      export and Loops/Airtable sync disagree with `rollUpHours`. Fix: apply
      the same filters (share one where-clause).

- [ ] **13. Editing only `hoursSource` leaves the week's analytics stale.**
      `src/app/api/projects/[id]/sessions/[sessionId]/route.ts:94` recomputes
      only when `hoursClaimed` changes, but `hoursSource` is editable
      (`src/lib/schemas/session.ts:24-38`) and decides whether the entry counts.
      Fix: recompute when either field changed.

- [ ] **14. A retried or double-submitted purchase of an unlimited item
      charges twice.** `src/lib/shop.ts:135-240` creates a new `ShopOrder` per
      call, so the `@@unique([shopOrderId, kind, bucket])` the schema calls
      "what stops a double-submitted purchase form from charging twice"
      (`prisma/schema.prisma:1243-1251`) cannot fire; the advisory lock only
      serializes. The only repeat guard is `maxPerUser > 0`, and `0` means
      unlimited. Fix: accept a client idempotency key and, inside the lock,
      return the existing matching order within a short window.

- [ ] **15. Staff order reads over-fetch internal cost and encrypted
      address/phone columns.** `src/lib/queries/admin.ts:174-178` fetches a
      user's orders with no `select`; `listOrders` (`:185-195`) uses `include`;
      the decision routes return the raw `ShopOrder`. Those rows carry
      `unitCostUsd`, `encryptedAddress`, `encryptedPhone` and `lastActorId` —
      exactly what `shopOrderPublicSelect` exists to keep server-side
      (`src/lib/shop.ts:24-44`) — and the user-detail route needs only
      `VIEW_USERS`, held by `REVIEWER` and `AUDITOR`. The encrypted columns are
      currently empty (nothing writes them yet), so the live leak is internal
      cost and actor ids; it becomes a PII leak when address capture is wired.
      Fix: explicit selects for the rendered/fulfillment fields only.

- [ ] **16. `/api/subscribe` is an unauthenticated email-registration oracle
      that hands out referral codes.** `src/app/api/subscribe/route.ts:39-53`
      returns `{ duplicate, referralCode }` for any address, with no proof the
      caller owns it; the Airtable sink returns the stored code on a hit
      (`src/lib/site/signups.ts:127-136`), as does the JSONL sink (`:219-227`).
      A loop over candidate addresses yields registered/not-registered plus
      codes for a list that includes minors. Fix: neutral response on a hit;
      release a code only to a matching session or after verification.

- [ ] **17. `airtable-retry` reports skipped writes as success.** The route
      counts any non-null `trackSideEffect` result as `synced++`
      (`src/app/api/integrations/airtable-retry/route.ts:27-39`), while an
      unconfigured/disabled sync resolves `{ skipped: … }`
      (`src/lib/airtable/sync.ts:163-167`, `src/lib/airtable/ysws.ts:114-119`)
      and `trackSideEffect` still writes an `AIRTABLE_SYNC_SUCCESS` audit row
      (`src/lib/side-effects.ts:36-58`). With Airtable unset, the payout-sink
      retry job is green, the audit log says success, and the admin panel shows
      `synced: N` while `/admin/program` lists the same hand-ins as never sent.
      Fix: treat `{ skipped }` as skipped — no success audit, no increment — as
      `rsvp-drain` and `loops-sync` already do.

- [ ] **18. `loops-sync` reads the email column under a different name than
      the drain writes it.** `src/lib/airtable/loops.ts:28` uses
      `email: "email"`, but the RSVP table's column is `Email`
      (`src/lib/airtable/schema.ts:109`), which the drain writes
      (`rsvp.ts:127-134`). Airtable field names are case-sensitive: the job
      either 422s or matches zero rows and reports a green run that updates
      nothing. Fix: read `RSVP.fields.email` via `fieldKey`.

- [ ] **19. RSVP rows that hit the 10-attempt cap are permanently
      unretryable.** `drainRsvpBuffer` only selects `syncAttempts < 10`
      (`src/lib/airtable/rsvp.ts:92`) and increments on failure (`:156`), while
      neither `bufferRsvp` (`:47`) nor `bufferRsvpForUser` (`:69`) resets the
      counter. A row that exhausted attempts during an outage stays invisible
      forever, even after the person RSVPs again or creates an account. Fix:
      reset `syncAttempts: 0` on both upsert updates.

- [ ] **20. An Ari decision is bound to `(project, phase)`, not to the ship
      the event names, so a stale approval can land on a later submission.**
      `src/lib/ari.ts:310-318` picks the newest open submission for the phase
      and `:396-399` writes `event.id` onto it without comparing the row's
      existing `ariSubmissionId`. If a maker unsubmits (allowed while
      `in_review`) and resubmits between Ari approving ship S1 and its webhook
      arriving, S1's approval is applied to submission B — the resubmitted work
      is approved without review, and B's recorded ship id becomes S1. Fix:
      look the row up by `ariSubmissionId === event.id` first, falling back to
      the phase only for legacy rows.

- [ ] **21. A failed Ari withdraw has no recovery path.**
      `…/unsubmit/route.ts:51-65` fires `withdrawSubmissionFromAri` in `after()`
      with no retry: a failure is only an `ARI_SYNC_FAILURE` audit row, and
      `ari-retry` replays sends, never withdrawals. The withdrawn hand-in stays
      in Ari's queue, and the next submission for the same `external_id`
      depends on Ari's duplicate semantics. Fix: make `ari-retry` (or a new
      job) replay failed withdraws, or record a withdraw queue.

- [ ] **22. A deferred build approval is invisible and has no local replay.**
      The item-10 fix throws `DESIGN_NOT_APPROVED` so Ari redelivers
      (`src/lib/ari.ts:344-362`), but nothing records that the decision is
      pending: `ari-retry` only replays ships with a null `ariSubmissionId`
      (this one has an id), there is no `ARI_WEBHOOK_FAILURE` audit action, and
      `/admin/program` lists unsent hand-ins only. If Ari's redelivery window
      is finite, a build approved before its design silently loses its
      approval. Fix: record the deferred decision and replay it from a job/admin
      surface.

- [ ] **23. `hackatime-sync` (and `loops-sync`) do unbounded work and only
      record the run at the end.** `…/hackatime-sync/route.ts:22-41` refreshes
      every link sequentially with a 10s timeout each, then calls
      `recordSyncRun`; a `maxDuration` kill leaves no `SyncRunLog`, and the
      next 15-minute run starts at the same head of an unordered list, so later
      links can starve. `loops-sync` loads all users with nested data the same
      way. Fix: batch with a cursor/limit and record partial results in a
      `finally`.

- [ ] **24. The landing signup writes through to Airtable synchronously; the
      buffered path is unused.** `src/lib/site/signups.ts:90-175` checks and
      writes Airtable first, while `docs/ARCHITECTURE.md:176-181` says "every
      RSVP lands in `RsvpBuffer`" and `README.md:94-106` documents the webhook
      sink. The form is fire-and-forget (`src/components/site/signup-form.tsx:111`),
      so a signup during an Airtable outage is silently lost; `POST /api/rsvp`
      (the buffered endpoint) is called by nothing. Fix: route landing signups
      through `bufferRsvp`/`/api/rsvp`, or correct the docs to state the real
      sink precedence.

- [ ] **25. `loops-sync` is built to run on a schedule but is missing from
      every schedule and health surface.** Its own comment says so
      (`…/loops-sync/route.ts:11-13`); the RUNBOOK job table lists six jobs and
      no Loops row (`docs/RUNBOOK.md:135-142`), and the admin panel's
      `getLatestSyncRuns` omits `airtable_loops` and `ari_ship`
      (`src/app/(platform)/(ops)/admin/page.tsx:21`). The Loops properties
      silently never update. Fix: add the job row and the two sync keys.

- [ ] **26. Per-entry hour approval is wired to nothing.** The
      `REVIEW_HOURS` permission, `POST /api/review/hours`,
      `WorkSession.hoursApproved` and hackatime overrides all exist, but no UI
      calls the route; the reviewer console offers only a whole-phase
      `hoursOverride` box (`src/app/components/forms/DecisionPanel.tsx:41`).
      Per-entry comments and `REVIEW_APPROVE_HOURS` are never written. Fix:
      build the review-hours panel the route was written for, or delete the
      route/permission and document override-only review.

- [ ] **27. Public reel links can be claimed but staff have no way to see
      them.** `PublicReel` is "kept so a post that goes viral can be found and
      paid for" (`prisma/schema.prisma:1509-1512`), and the submission dialog
      collects the links, but no admin query, page or export selects them
      (`rg publicReel` finds only the write and the owner's read). Fix: a
      public-reels table on `/admin`, or include them in the participant
      export.

- [ ] **28. `BETTER_AUTH_SECRET` is not checked at boot, so the pod looks
      healthy while every auth page 500s.** `src/lib/auth.ts:31` reads it, and
      better-auth throws in production when it is missing
      (`node_modules/better-auth/dist/context/create-context.mjs:42-43`), but
      nothing imports auth at boot: `/api/health` touches only Prisma and
      `src/instrumentation.ts:12-18` checks only `PII_ENCRYPTION_KEY`. The
      healthcheck stays green while the first page/API that touches auth
      throws. Fix: validate `DATABASE_URL`, `BETTER_AUTH_SECRET` and
      `BETTER_AUTH_URL` in `register()`.

- [ ] **29. No CSP and no HSTS anywhere.** `src/proxy.ts:19-25` is the only
      header setter (X-Frame-Options, nosniff, Referrer-Policy,
      Permissions-Policy). `X-Frame-Options: DENY` covers clickjacking on
      `/admin`/`/review`, but there is no `frame-ancestors` fallback and no
      transport hardening for a cookie app. Fix: add HSTS (and a CSP if the
      inline styles/scripts allow), or document that the ingress supplies them.

- [ ] **30. The Leaderboard is promised by the docs and does not exist.**
      `README.md:33` lists it in the route tree, `DESIGN.md:443,617` describes
      its tab and magenta sign, and `docs/platform-ui.md:98` includes it in the
      tour; no `leaderboard` route exists (deleted in `490fe15`) and the sidebar
      has no entry (`src/components/platform/shell/Sidebar.tsx:16-24`). Either
      rebuild it or update the three docs — as it stands, operators and
      participants are told about a destination that was silently cut.

- [ ] **31. Slack's endpoints sit behind the pre-launch basic-auth gate.**
      `src/proxy.ts:114-119` excludes `api/integrations`, `api/health`,
      `api/handoff/upload` and `r/` from basic auth, but not `api/slack/*`.
      The RUNBOOK says to keep `REQUIRE_BASICAUTH=true` until launch, so
      Slack's Request-URL verification and events get 401s during the setup the
      RUNBOOK asks for — the "buttons stay dead" symptom item 1 fixed in the
      handler. Fix: exclude `api/slack` (it verifies its own signature), or
      sequence the app setup after the gate is removed.

- [ ] **32. A reel owed at week close can turn a live tab into a dead map.**
      `src/lib/store.tsx:1001-1006` checks `isPassed(id)` before the
      `owedReels.includes(id)` escape hatch, and `isPassed` (`:950-958`) has no
      exception for a reel node. Delete a checkpoint reel, leave the tab open
      until the week closes (the client clock advances at `:247-254`): every
      node renders disabled, there is no "start here" callout, and only the
      owed node has a tooltip — "This week has passed!" — until a reload
      refetches `owedReels`. Fix: check `owedReels` before `isPassed`, and/or
      drop a passed week from the hold when the clock crosses its close.

## 4. Low / cleanups

- [ ] **33. `unapprovePhase` / `reopenPhase` read status outside the
      transaction and write unconditionally.** `src/lib/review.ts:444-452` and
      `:556-570`; a slow unapprove can overwrite a newer approval. Re-read and
      use a conditional `updateMany` inside the locked transaction.
- [ ] **34. The analytics export uses the raw `currentStreak` column, not
      `streakAsOf`.** `src/lib/analytics.ts:327-328, 350-351` — a stale cache
      for anyone who stopped journalling (`src/lib/streak.ts:155-160`). Compute
      the as-of value in `getUserAnalytics`.
- [ ] **35. HCB memo failures are swallowed and a null transaction id still
      marks the grant sent.** `src/lib/grants.ts:120-121, 152-156` — route the
      memo through `trackSideEffect` and flag a missing id for follow-up.
- [ ] **36. `ThemeProject.buildCoins` records only the spendable half.**
      `src/lib/review.ts:310` writes `coins?.spendable` while the build also
      mints `BUILD_BANKED_HOURS`; the schema says these frozen fields reconcile
      against the ledger. Store the split or rename the field.
- [ ] **37. Tracked sessions distort two read-only surfaces.**
      `src/lib/hours.ts:81-86, 117, 131` counts timelapse seconds for
      `HACKATIME_TRACKED` sessions in the coverage numerator but not the
      denominator; `src/lib/queries/community.ts:69, 84, 91` shows their
      minutes and embeds the author's Slack id in a public cachet avatar URL
      (the module's comment says neither is shown), as does
      `src/lib/feed.ts:62, 86`.
- [ ] **38. The BOM lock is checked outside any write transaction.**
      `src/app/api/projects/[id]/bom/route.ts:48-68` — a design approval
      between the check and the create lets a line in after the list is final.
      No money impact (BOM savings is not shipped). Conditional create under
      the project status.
- [ ] **39. The public rate limits key on a caller-controlled header.**
      `src/app/api/subscribe/route.ts:13-18` and
      `src/app/api/rsvp/route.ts:16-24` take the first `x-forwarded-for`
      entry; the limiter is per-instance (`src/lib/site/signups.ts:250-265`).
      Rotating the header bypasses it. Key on an ingress-overwritten header
      (`cf-connecting-ip`) or the trusted hop only.
- [ ] **40. The help-channel "Mark as helped" button is open to every
      member.** `src/app/api/slack/interactions/route.ts:113-140` has no
      author/staff check (unlike `handleSelfResolve`, `:80-88`), and the help
      channel is auto-joined by anyone who joins the main channel
      (`src/app/api/slack/events/route.ts:155-164`). Any participant can
      resolve any ticket thread. Check channel membership before resolving.
- [ ] **41. `/api/upload` has no per-user quota or rate limit.**
      `src/app/api/upload/route.ts:18-53` — an authenticated account can store
      unlimited 100 MiB objects under its own prefix with public URLs. Add a
      per-user rate limit plus an aggregate byte/object cap.
- [ ] **42. Accessibility leftovers from the dialog-name fix.**
      `[tracked-incomplete]` — PRELAUNCH_AUDIT.md #22.
      `src/components/platform/modals/FirstCheckpoint.tsx:64-71` (loading) and
      the `OnboardingFlow` dialog render `ModalTitle`-less dialogs, so the first
      modal every participant sees has no accessible name
      (`Modal.tsx:139-141`); the first-run spotlight's full-viewport wrapper
      swallows clicks on the highlighted checkpoint it says stays clickable
      (`src/components/onboarding/Spotlight.tsx:275-279`,
      `Overlays.tsx:146-159`); the intro overlay leaves the hidden shell
      keyboard-focusable (`AppShell.tsx:85-91`); and `ReelComments` ids are
      duplicated when both the panel and sheet are mounted
      (`ReelComments.tsx:213-316`, `ReelViewer.tsx:490-541`).
- [ ] **43. Landing/content cleanups.** The announcement and FAQ dates
      disagree with each other and with the default program schedule
      (`src/lib/site/content.ts:62-68, 180-181` vs
      `src/lib/config/program.ts:49`); `MAKE_PHOTO` is dead config whose comment
      claims two call sites that do not exist (`content.ts:256-271`);
      `text-opacity-40` is a no-op under Tailwind v4 (`process.tsx:688`);
      `orLapse` is a dead variable that removed the timelapse hint from the
      journal shortfall message (`CheckpointModals.tsx:158-165`); and
      `SubmitModal`'s capture leaks blob URLs (revoked in `ReelModal`,
      `CheckpointModals.tsx:808-813`, but not at `:1695-1702`).
- [ ] **44. Proxy/header edges.** Every path the matcher excludes loses the
      security headers — including `/r/<token>`, whose URL is the credential
      and which therefore has no `Referrer-Policy` (`src/proxy.ts:119`). The
      exclusions are also unanchored prefixes, so a
      future `/api/integrations-…` or `/r/...` path would silently skip basic
      auth (`proxy.ts:119`). Anchor them.
- [ ] **45. Docker/deploy cleanups.** `COPY . .` (`Dockerfile:32`) can clobber
      the freshly generated Prisma client with a stale local one, since
      `.dockerignore` does not exclude `src/app/generated`; the runner ships
      the whole dev dependency tree (`Dockerfile:72` — typescript, eslint,
      biome, tsx); the entrypoint ignores any command passed to the image
      (`docker-entrypoint.sh:11`), which matters if Orchard jobs override the
      command; CI never builds the Docker image
      (`.github/workflows/ci.yml`), which is how finding 6 stays green; the dev
      Postgres is published on all interfaces
      (`docker-compose.dev.yaml:9`); and migration `20260901215004` adds a
      `NOT NULL` column with no default, so it cannot replay on a database that
      already has account rows (fresh production is fine).
- [ ] **46. Unwritten or unwired schema/code.** Project delete/restore,
      `ShopOrderNote`, `LedgerKind.REVIEWER_PAYMENT`, the User
      attribution/bio/pronoun columns and the `ADMIN_DELETE_PROJECT`/
      `ADMIN_RESTORE_PROJECT` actions have no writers; `submissionsCloseAt`
      and `shopClosesAt` are read by the gates and accepted by the API but not
      editable in the settings form; `needsOnboarding` is only called by its
      test; `backfillAnalytics` has no script/route entry point; and
      `src/lib/queries/dashboard.ts`, all of `src/lib/queries/project.ts`,
      several read-only admin routes (`/api/program`, `/api/credits`,
      `/api/shop/items`, `/api/review/queue`, `/api/admin/audit`,
      `/api/admin/theme-projects/unsynced`) and the old `Wobble` helpers have
      no callers. Note the audit record: PRELAUNCH_AUDIT.md #33 (dashboard
      N+1) rewrote `queries/dashboard.ts`, which is dead — the live dashboard
      uses `queries/store.ts`. Delete or wire; correct the audit note.
- [ ] **47. Documentation corrections.** `docs/RUNBOOK.md:171` says every
      integration route accepts `?dryRun=true`, but `printer-reconcile` writes
      a `SyncRunLog` regardless; `docs/ARCHITECTURE.md:160` promises an
      Airtable upsert that does not exist (see finding 2), and `:122` still
      states the old UTC week formula the item-17 fix replaced;
      `README.md:145-146` says the carousel credits are placeholders when
      `src/lib/site/content.ts:187-219` carries real makers; and
      `README.md:99` documents a signup payload shape the code does not send.
- [ ] **48. Environment-template gaps.** `SIGNUP_WEBHOOK_URL` /
      `SIGNUP_WEBHOOK_TOKEN` are read (`src/lib/site/signups.ts:177-209`) and
      documented in the README but absent from `.env.example`, so RUNBOOK step
      "pass every var from .env.example" will not configure them; the same
      applies to `LAPSE_WEB_BASE`, `HCA_ME_URL` and `AIRTABLE_TABLE_NAME`.
- [ ] **49. Ari API-surface leftovers.** `sync-to-ari` accepts a replay for an
      already-sent hand-in and ignores `deletedAt`
      (`…/sync-to-ari/route.ts:40-48`; harmless today — Ari dedupes — but the
      check belongs there); `selectPendingShips`'s tie-break depends on row
      order when timestamps collide (`src/lib/ari-pending.ts:34`, no `orderBy`
      at `ari.ts:249-252`); and `ari-retry` snapshots pending state then sends
      later with no re-check, so a phase unsubmitted in between can still get a
      ship (`ari-retry/route.ts:20-39`, `ari.ts:206-219`).
- [ ] **50. Foreign attachment keys are dropped silently at submit.**
      `src/lib/submissions.ts:141-142` filters non-owned keys instead of
      refusing, so evidence disappears with a success response — the opposite
      of the sessions route's rule (`…/sessions/route.ts:101-104`).
- [ ] **51. The WebM check accepts audio-only files.**
      `src/lib/uploads/r2.ts:97-106` only checks the EBML magic for non-MP4,
      so an audio-only `.webm` with a video MIME passes. Low impact.
- [ ] **52. Two stale git stashes exist on `unify-platform-ui`.**
      `stash@{0}` is a harmless `grant-admin` alias; `stash@{1}` is an older,
      less-safe variant of the Hackatime Linking code that predates the
      `*.link.invalid` mitigation. Drop them (or rebase deliberately) before
      someone pops the wrong one.

## 5. Verified clean, and prior fixes re-confirmed

- **Authorization and IDOR (all 72 handlers):** every route calls a guard and
  the permission matches the operation, including the `grantUsdOverride`
  re-gate on `MANAGE_CREDIT` and `grantSchema` rejecting `BUILD`; every
  `[id]` route is owner/role-scoped; unset integration secrets yield 503, never
  an open route; bearer compares are constant-time; mass assignment is closed
  by `.strict()` schemas and explicit selects. No IDOR or CSRF path found.
- **Webhooks and tokens:** Slack HMAC over the raw body (5-minute window,
  timing-safe, verified before parsing) and Ari HMAC over the raw body
  (WebCrypto `subtle.verify`, 300s tolerance, delivery id recorded only after
  success) are correct. Handoff tokens are 256-bit, stored hashed, single-use,
  owner-scoped and expire in 10 minutes; Ari's `ships.create` returns the
  existing id on `duplicate`, so the new admin Retry route cannot double-ship.
- **XSS:** the only `dangerouslySetInnerHTML` sinks are static constants and
  server-generated QR SVGs. Journals, reels, comments and project text render
  through React nodes; `Markdown` builds elements only; `safeHref`/`safeSrc`
  and `httpsUrl` close `javascript:`/`data:`; every free-text field passes
  DOMPurify before persistence.
- **Money core:** the ledger's earning kinds, per-bucket sums,
  `reconcileGrant` convergence, `lockUserCredit` coverage of
  purchase/refund/fulfil/decide/unsubmit, the submit/unsubmit conditional
  writes, the review-claim re-check, `_max`-based shop grace, and the
  per-phase coin cap are all correct. Grant CAS/abandoned-window, Lapse clip
  locking and the two-pot refund split are correct.
- **Hours:** `rollUpHours`/`getHoursBreakdown` apply the `HACKATIME_TRACKED`
  exclusion consistently; `hoursApproved` overrides work; week maths is
  program-timezone calendar days; printer pacing matches the budget sheet.
- **Notifications, uploads, onboarding:** Slack throws on `ok:false`, email
  throws when unconfigured, failures land as audit rows and the HTML is
  escaped; upload validation requires extension+MIME agreement and video magic
  bytes; the onboarding state machine cannot skip, rewind or unlock a starter
  tier.
- **Client discipline:** no client-only access decisions; every mutation
  refreshes or patches server state; pollers, listeners, rAFs and video
  elements all clean up. Landing anchors resolve and the scroll-cue fix is
  present.

## 6. Still open from the earlier audits (external/operator)

Unchanged from `PRELAUNCH_AUDIT.md` §6 and `todo.md`, all operator work:

- **One canonical host** across `slack-app-manifest.yml`, `BETTER_AUTH_URL`,
  `NEXT_PUBLIC_APP_URL`, the Ari webhook URL and OAuth redirect URIs.
- **Rotate** the credentials that lived in `.env.old` (and `import/.env`, see
  finding 7); delete `.env` before the directory is shared or archived.
- **Ari**: program id + signing/webhook secrets, register the callback, run the
  `ari-retry` job; `SLACK_REVIEW_CHANNEL_ID` if dispute notices are wanted.
- **Email**: `RESEND_API_KEY` + a verified `EMAIL_FROM`.
- **HCB** (only if the manual fallback is wanted): OAuth app with
  `card_grants:read`, manager invite, rotated refresh-token persistence — and
  findings 1, 10 and 11 first.
- **R2**: bucket, token, public domain, `NEXT_PUBLIC_UPLOAD_HOST`, and pass the
  `NEXT_PUBLIC_*` build args in the deploying platform.
- **Signup sink**: point `SIGNUP_WEBHOOK_URL` at a real provider, or accept the
  Airtable path (finding 24); the JSONL fallback is not durable and `data/`
  may not be writable.
- **Landing facts**: confirm the EIN, mailing address and the real
  announcement/FAQ dates (finding 43).
- **Backups + alerting**: daily backup schedule, channels, one proven restore.

## 7. Decisions to confirm

- **Finding 2**: add the `Half-Life ID` + `Stage` fields to the Airtable table
  and use `performUpsert` (the architecture's stated design), or accept
  single-writer serialization as the guarantee?
- **Finding 8 / 27**: is printer fulfilment deliberately manual for v1? If
  not, it is the largest missing operator surface; public-reel payouts have
  the same question.
- **Finding 14**: should a duplicate purchase be idempotent, or is a manual
  refund the intended correction? Fix either the code or the schema comment.
- **Finding 30**: rebuild the Leaderboard or retract it from the three docs?
- **Finding 15 / 37**: confirm the staff-facing field policy before wiring
  address capture, and decide whether Slack ids in avatar URLs are acceptable
  (then fix the comments that say they are not).
