# Pre-launch audit — 2026-09-28

An independent pass over the repository looking for things that should be fixed
before the programme opens. It complements [LAUNCH_FIXES.md](./LAUNCH_FIXES.md)
(the earlier launch review, 12 of 14 items done) rather than replacing it; items
that are still open there are repeated in §2/§5 with a `[tracked]` marker.

Method: read the code directly, plus parallel audit passes over the API routes,
integrations, frontend, data/business logic and deploy config. Every issue below
was confirmed in the source. `pnpm typecheck`, `pnpm lint`, `pnpm build` and
`pnpm verify:contracts` all pass; the DB-backed verify suites were not run
(no database was up).

Legend: **BLOCKER** — launch is damaged without it · **HIGH** · **MED** · **LOW**

## Start here — all nine fixed

The nine items this batch started from are ticked below, one commit each:
`e9f9549` (Slack challenge) · `e4b41a8` (Slack ack/retry) · `1f9bec2`
(onboarding copy) · `af0e870` (runbook repo) · `951a440` (unsubmit race) ·
`1e255ea` (submit race) · `72b0e72` (HCB double-send) · `10d10a9` (Airtable
duplicates) · `e3aa611` (Hackatime links in review).

Two follow-ups from this batch:

- The onboarding copy in item 3 is written to be true and in the program's
  voice, but it is new editorial content — give it a read before it ships.
- Item 7 now reads a grant's disbursements before a retry, so the HCB OAuth
  app needs the `card_grants:read` scope as well as `card_grants:write` (noted
  in `.env.example`).

Everything not ticked is still open.

---

## 1. Launch blockers

- [x] **1. Slack ticket buttons cannot be enabled: the interactivity route
      never answers the `url_verification` challenge.** **BLOCKER**
  - `src/app/api/slack/interactions/route.ts:139-175` only handles
    `block_actions` found under a form `payload`; a
    `payload.type === "url_verification"` request gets a 400 (no payload) or a
    bare `{ ok: true }` with no `challenge`, so saving the Request URL in
    `slack-app-manifest.yml:58-60` fails verification and the "Mark as helped" /
    "I'm all set" buttons stay dead. The events route does this correctly
    (`src/app/api/slack/events/route.ts:186-188`).
  - Fix: parse the form payload first, and if `payload.type === "url_verification"`
    return `{ challenge }` before anything else.

- [x] **2. Same route does its work before acking, with no retry guard — one
      click can post duplicate "resolved" messages.** **BLOCKER**
  - `handleMarkHelped` / `handleSelfResolve` / `handleThreadMarkHelped`
    (`src/app/api/slack/interactions/route.ts:35-137`) `await` up to two Slack
    calls (10s timeout each, `src/lib/site/slack.ts:34`) before the 200. Slack
    retries interactivity after 3s and this route has no
    `x-slack-retry-num` check (the events route has one at
    `events/route.ts:193-195`), so a slow call re-runs the handler and re-posts
    the help-channel ack.
  - Fix: ack `200` first and do the work in Next's `after()`, and drop
    retries the way the events route does.

- [x] **3. Onboarding ships placeholder copy that the code itself says must be
      replaced before launch.** **BLOCKER**
  - `src/lib/config/onboarding.ts:105-108` — "⚠️ PLACEHOLDER COPY … Replace
    before launch — participants will actually build these" for
    `STARTER_PROJECTS`; `:159-162` — "should be rewritten before launch" for
    the PCB week primer. Both are surfaced to every new participant through
    `src/lib/onboarding-view.ts:64-74` and the `OnboardingFlow`.
  - Fix: write the real starter projects and PCB intro, or remove them from the
    first checkpoint.

- [x] **4. The deploy runbook tells Orchard to build the wrong repository.**
      **BLOCKER (ops doc)**
  - `docs/RUNBOOK.md:65` — `githubRepo: hackclub/half-life`, but this repo's
    remote is `https://github.com/hackclub/halflife`, and
    `hackclub/half-life` redirects to a different project
    (`hackclub/half-life-test-backend`). Following the runbook deploys someone
    else's codebase.
  - Fix: correct the owner/repo in the runbook (and anywhere else it is copied).

- [x] **5. Unsubmitting can race a decision and delete the resolved
      submission, erasing the review on the way out.** **BLOCKER**
  - `unsubmitPhase` (`src/lib/submissions.ts:201-231`) reads status/claim
    outside its transaction, then `tx.phaseSubmission.delete({ id })` with no
    `resolvedAt: null` predicate and without taking the credit advisory lock
    that `finalizeReview` holds (`src/lib/review.ts:216-395`). If the reject /
    return lands between the read and the delete, the delete succeeds, the
    cascade removes `SubmissionReview`/claim/dispute rows
    (`prisma/schema.prisma`, PhaseSubmission relations) and the phase is set
    back to `draft` — the participant has undone a rejection and can resubmit
    from a clean slate.
  - Fix: delete inside the transaction conditional on
    `resolvedAt: null` (and re-read status under a lock), or refuse a delete
    once the submission is resolved.

- [x] **6. Two concurrent submits can create two open submissions for one
      phase.** **BLOCKER (data integrity)**
  - `submitPhase` (`src/lib/submissions.ts:107-199`) checks `canSubmitPhase`
    outside the transaction, then unconditionally creates a `PhaseSubmission`
    and flips the status to `in_review`; there is no partial unique index on
    `(themeProjectId, phase)` and `unsubmitPhase` only deletes the newest open
    row (`:211-216`). A double-click/retry puts two identical entries in the
    review queue (and two Ari ships for the same key), each independently
    decidable.
  - Fix: conditional `updateMany` on the current status (or a partial unique
    index) so only one open submission per (project, phase) can exist.

- [x] **7. HCB grants can be sent twice: a timed-out top-up is retryable, and
      the API accepts `phase: BUILD`.** **BLOCKER (money)**
  - `sendGrant` (`src/lib/grants.ts:58-102`) writes the failure to the row and
    lets a re-click retry; `topUpCardGrant` (`src/lib/hcb.ts:92-108`) is a bare
    POST with no idempotency key, so a call that HCB applied but whose response
    timed out (20s) is sent again on retry. Separately, the idempotency key
    includes `phase`, `grantSchema` accepts BUILD
    (`src/lib/schemas/admin.ts:20-25`) while `sendGrant` validates only
    "approved design + grantUsd" (`src/lib/grants.ts:46-56`) — an API call with
    `phase: "BUILD"` sends the same design grant a second time under a new key.
    (The UI hardcodes DESIGN at `GrantForm.tsx:43`; the API is the hole.)
  - Fix: reject `phase !== DESIGN` in `sendGrant`, and before retrying a
    failed row, reconcile with HCB (list the grant's disbursements by memo /
    amount / window) rather than assuming nothing happened.

- [x] **8. Airtable YSWS writes can duplicate a payout row on retry or under
      concurrency.** **BLOCKER (payout sink)**
  - The row id only exists in an `AIRTABLE_SYNC_SUCCESS` audit row
    (`src/lib/airtable/sync.ts:38-52`), and `writeYswsRecord` POSTs a new row
    when it has none (`src/lib/airtable/ysws.ts:60-105`); Airtable 5xx/timeouts
    are retried by re-calling the same POST (`src/lib/airtable/client.ts:88-104`),
    so a create whose response was lost becomes a second row, and two
    concurrent first writes (submit hook + `airtable-retry`) both create.
    `docs/ARCHITECTURE.md:160` promises `performUpsert` keyed on
    `(Half-Life ID, Stage)`, but that field does not exist in
    `src/lib/airtable/schema.ts`. Duplicate "Pending Review" rows reach
    reviewers and the payout team.
  - Fix: at minimum, do not retry a create blindly (a create is not idempotent);
    ideally add the Half-Life ID + Stage fields and use Airtable's upsert.

---

## 2. High

- [x] **9. Hackatime links can be added or removed while a phase is in
      review, changing the hours the decision pays.** **HIGH**
  - `POST /api/projects/[id]/hackatime` (`route.ts:49-54`) and `DELETE
    …/[linkId]` (`route.ts:26-33`) guard only `isPhaseDecided`, not
    `in_review` (or the global submissions gate). `finalizeReview` recomputes
    hours live at decision time (`src/lib/review.ts:169-181`, `live: true`), so
    a maker can link more tracked time after hand-in and be paid for it. The
    journal-session paths correctly block `in_review`; these do not.
  - Fix: apply the same `in_review` freeze (and `getSubmissionAccess`) to link
    add/remove.

- [ ] **10. A build approved by Ari before its design is permanently
      ignored.** **HIGH**
  - `src/lib/ari.ts:369-376` treats `DESIGN_NOT_APPROVED` from
    `finalizeReview` (`src/lib/review.ts:154-156`) as an unappliable decision:
    it logs `ARI_WEBHOOK_IGNORED`, records the delivery id and acks. Ari has
    independent ships per phase, and Half Life explicitly allows build
    submission before design approval (`docs/ARCHITECTURE.md:135-142`), so this
    ordering is normal — the build approval is then never re-applied when the
    design is later approved, and the maker silently loses build credit.
  - Fix: keep the delivery unrecorded (or record it as deferred) so a retry can
    apply it once the design lands, or queue it for `ari-retry`.

- [ ] **11. A journal entry can be deleted while the review that depends on it
      is live.** **HIGH**
  - `PATCH .../sessions/[sessionId]` blocks `in_review` (`route.ts:54-64`), but
    `DELETE` (`route.ts:99-115`) checks only `hoursApproved`,
    `isPhaseDecided` and week-open. A participant can remove evidence while a
    reviewer is reading it (and no `getSubmissionAccess` check either).
  - Fix: mirror the PATCH guard.

- [ ] **12. `/api/review/hours` can rewrite approved hours on decided phases
      and unrelated projects.** **HIGH**
  - `src/app/api/review/hours/route.ts:40-89` updates any session/link id with
    no `isPhaseDecided` check, no submission/claim check and no refresh of
    `ThemeProject.approvedHours`/frozen coins. A `REVIEW_HOURS` holder can, by
    API, change hours on a draft project or after a decision, which a later
    un-approve/re-approve cycle then pays against.
  - Fix: restrict writes to sessions/links whose phase is `in_review` and to
    claims held by the caller (or make it a decision-route-only operation).

- [ ] **13. The shop grace window is read off the most recently *updated*
      project, not the most recent review.** **HIGH (money, user-facing)**
  - `getShopAccess` (`src/lib/program.ts:261-286`) picks one project with
    `orderBy: { updatedAt: "desc" }` and reads only that row's
    `designReviewedAt`/`buildReviewedAt`. Any unrelated write (title edit,
    extension, resubmit) bumps `updatedAt` without touching the review dates,
    so the row it picks can have `null`/old review dates while another project
    was reviewed minutes ago — the grace window collapses and credit awarded at
    the buzzer becomes unspendable.
  - Fix: `aggregate _max` over both review-date columns (or filter to rows with
    a review date).

- [ ] **14. `export/participants` still returns email + slackId to any export
      key.** **HIGH** `[tracked]` — `LAUNCH_FIXES.md` #13
  - `src/app/api/integrations/export/participants/route.ts:29-51` contradicts
    its own comment. Confirm every `EXPORT_API_KEY` holder is trusted with the
    full roster, or scope the fields per key.

- [ ] **15. Live-looking secrets remain in the working tree, and `.env` has
      `PULL_HCA_PII=true`.** **HIGH** `[tracked]` — `LAUNCH_FIXES.md` #14
  - `.env` / `.env.old` / `import/.env` are gitignored and untracked, but hold
    live-looking Slack, HCA, Hackatime, Lapse, R2 and Airtable credentials.
    Rotate and delete `.env.old` before the directory is shared/archived.
  - Additionally, `.env:23` sets `PULL_HCA_PII=true`, which adds
    `address`/`birthdate` scopes (`src/lib/auth.ts:18-19`). HCA refuses the
    whole sign-in if any requested scope is not enabled on the app — verify the
    app's scopes and `PII_ENCRYPTION_KEY`, or set it to `false`.

---

## 3. Medium

- [ ] **16. The printer goal picker ignores the banked printer fund.**
      `GoalModal.tsx:20,34-35` computes `toGo`/`weeksToGo` from `coins`
      (spendable only), but a printer is paid from `printerFund =
      coins + bankedCoins` (`src/lib/store.tsx:115,1102`;
      `src/lib/currency.ts:79-81`). A saver with most of their money banked is
      told the wrong "coins to go" and "weeks to go".
  - Fix: use `printerFund` in the modal and in `weeksToGo`.

- [ ] **17. Week numbers flip at UTC midnight while weeks close at program-tz
      midnight.** `weekNumberForDate` (`src/lib/program.ts:37-41`) uses raw
      elapsed time from a UTC-midnight `eventStartDate`, but `weekClosesAt`
      (`:62-73`) closes at wall-clock midnight in `programTimezone`. For the
      default `America/New_York`, work logged in the last four to five hours
      before the program-timezone close (Sunday evening ET) is stamped into the
      next week although the week is still open, corrupting
      `WorkSession.weekNumber`, `submittedInWeek`, `onTime` and `UserWeek`
      analytics (the docs say this maths is in the program timezone).
  - Fix: derive the week from the program-tz calendar date, not UTC epochs.

- [ ] **18. Slack/email notification failures are invisible to the failure
      audit.** `slackCall` (`src/lib/slack.ts:9-32`) returns `null` on
      `ok:false`/throw and `sendDM` returns `false`; `trackSideEffect`
      (`src/lib/side-effects.ts:21-89`) only logs `NOTIFICATION_FAILURE` when
      the callback throws, so a revoked bot token or "not in channel" produces
      no audit row, just a console warning. `sendEmail` returns
      `{ skipped: "not_configured" }` without throwing (`src/lib/email.ts:28`),
      so a deployment missing `RESEND_API_KEY` looks healthy.
  - Fix: throw (or explicitly record) on `ok:false` and on skipped email.

- [ ] **19. Airtable RSVP reads and writes default to different tables.**
      `src/lib/airtable/schema.ts:99` defaults to `"RSVPs"` while
      `src/lib/airtable/loops.ts:24` defaults to `"Signups"`. If
      `AIRTABLE_RSVP_TABLE_ID` is unset, the count reads one table and the
      drain writes another, silently. Set the var in every deployment (or make
      the two defaults one constant).

- [ ] **20. Non-GitHub repos can be saved but can never be submitted.**
      `normalizeRepo` explicitly accepts GitLab/Codeberg
      (`src/lib/repo.ts:3-8`), but `checkRepo` marks anything
      `parseGitHubRepo` rejects as a blocking failure
      (`src/lib/repo-checks.ts:236-246`). Either say "GitHub only" at the
      input, or make the checks degrade for other hosts.

- [ ] **21. A Hackatime project cannot back both phases of one project.**
      `@@unique([themeProjectId, hackatimeProject])`
      (`prisma/schema.prisma:814`) omits `phase`, and the link route returns
      `CONFLICT` regardless of phase (`…/hackatime/route.ts:60-68`), while
      `getHoursBreakdown` filters links by phase (`src/lib/hours.ts:71-74`).
      Linking the same tracked project for design silently excludes its time
      from build (or refuses the link).
  - Fix: include `phase` in the unique key and in the conflict check.

- [ ] **22. Some dialogs announce no name.** `Modal.tsx:125` sets
      `aria-labelledby={labelledBy ?? titleId}`, but Modal's own `titleId`
      (line 48) is never rendered, and callers that do not pass `labelledBy`
      get a dangling reference. Several callers do wire it correctly
      (`GoalModal.tsx:48,90`; `CheckpointModals.tsx:616,646,672,874,1219`), but
      others do not — the journal editor (`CheckpointModals.tsx:230,297`),
      `FirstCheckpoint.tsx:53-55`, and the modals at `CheckpointModals.tsx`
      898/1051/1412 render a `role="dialog"` with no accessible name.
  - Fix: render Modal's own `titleId` on a `ModalTitle` (e.g. via context), or
    pass `labelledBy` + matching `id` from every caller.

- [ ] **23. Staff forms go silent on a network failure.**
      `DecisionPanel.tsx:51-79` (and `ShopItemForm`, `ItemCostField`,
      `ProgramSettingsForm`, `CreditGrantForm`, `RoleEditor`, `OrderDecision`)
      use `try { … } finally { setBusy(false) }` with no `catch`. A rejected
      fetch raises an unhandled rejection and leaves no error message — the
      reviewer cannot tell the decision did not save.
  - Fix: add the same `catch → setError("Could not reach the server")` these
    forms already use for HTTP errors.

- [ ] **24. One Lapse recording can back two journal entries under
      concurrency.** The "already backs another journal entry" check
      (`…/sessions/route.ts:110-123`) is a read-then-create and
      `SessionTimelapse` has only a non-unique
      `@@index([provider, externalId])`; two parallel submissions of the same
      `lapseId` both pass and insert. Same footage counted twice as evidence.
  - Fix: a unique index on `(provider, externalId)` where the session is live,
    or create with a conditional insert.

- [ ] **25. Local signup data is baked into the Docker build context.**
      `.dockerignore` does not exclude `data/`, so `data/signups.jsonl` (real
      email addresses) is sent to the daemon and retained in builder layers via
      `COPY . .` in the `builder` stage. Add `data` to `.dockerignore`.

- [ ] **26. `NEXT_PUBLIC_*` build-time variables are never passed to the
      Docker build.** `next.config.ts:50-58` bakes
      `NEXT_PUBLIC_UPLOAD_HOST` into `images.remotePatterns` and
      `src/lib/auth-client.ts:12` bakes `NEXT_PUBLIC_APP_URL` into the client
      bundle, but the `builder` stage (`Dockerfile:32-40`) has no `ARG` for
      either and Orchard supplies runtime env only. The R2 host ends up missing
      from the allowlist and the browser auth client silently falls back to the
      current origin instead of the configured URL. (Current `<img>`/`<video>`
      usage hides the first one.)
  - Fix: declare and pass both as build args/ENV in the Dockerfile, or drop
    the `NEXT_PUBLIC_` prefix where the value is only read on the server.

- [ ] **27. Weekly analytics count Hackatime-tracked sessions the ledger
      deliberately excludes.** `recomputeWeek` sums `hoursClaimed` with no
      `hoursSource` filter (`src/lib/analytics.ts:124-128`), while
      `rollUpHours` skips `HACKATIME_TRACKED` sessions entirely
      (`src/lib/hours.ts:163-168`). Progress numbers and milestones can
      disagree with what a reviewer/decision sees.

- [ ] **28. The BOM-savings half of the economy is never written.**
      `ThemeProject.bomSavingsUsd` is documented as "converts 1:1 into
      spendable coins" (`prisma/schema.prisma:575-577`) and
      `LedgerKind.BOM_SAVINGS` / `PARTS_TOP_UP` exist (`:108-110`), but nothing
      in the app sets the field or appends those rows. Decide whether launch
      needs the receipts → coins flow, or mark it explicitly as not shipped.

---

## 4. Low / cleanups

- [ ] **29. `/api/rsvp` is public, unthrottled and write-unbounded** —
      `src/app/api/rsvp/route.ts:11-31` (the sibling `/api/subscribe` rate-limits
      at `subscribe/route.ts:16-18`). An attacker can grow `RsvpBuffer` and the
      public counter; add a limiter.
- [ ] **30. Missing `DATABASE_URL` fails open at runtime** —
      `src/lib/prisma.ts:10` falls back to a placeholder so the pod boots and
      500s on every request; fail fast at startup instead.
- [ ] **31. Invalid `?action=` on `/admin/audit` returns 500** —
      `src/app/api/admin/audit/route.ts:11-13` accepts any string and passes it
      to Prisma (`src/lib/queries/admin.ts:307`); reject non-enum values as 400.
- [ ] **32. Concurrent onboarding answers can rewind the step marker** —
      `src/lib/onboarding.ts:227-251` writes `onboardingStep: reached` from a
      snapshot read before the transaction; a slow earlier answer can overwrite
      a later one (monotonic `updateMany` or re-read inside the transaction).
- [ ] **33. Dashboard N+1** — `src/lib/queries/dashboard.ts:60-66` calls
      `getHoursBreakdown` twice per project (3 queries each), ~30 queries per
      render for 5 projects; use the `rollUpHours` bulk path like
      `queries/store.ts`.
- [ ] **34. `buildHoursJustification` is dead code** —
      `src/lib/justification.ts:11` has no callers, yet the docs describe the
      reviewer's reason as feeding the grant row's hours justification. Wire it
      up or delete it.
- [ ] **35. Last-admin revocation check is racy** —
      `src/app/api/admin/users/[id]/roles/route.ts:52-59` counts then deletes
      without a transaction/lock; two concurrent revokes can leave zero admins.
- [ ] **36. Fulfillment status write is racy** —
      `src/app/api/admin/shop/orders/[id]/fulfillment/route.ts:25-52` reads the
      status then unconditionally updates; an order rejected in between can
      still be marked SENT_FOR_DELIVERY. Use a conditional `updateMany`.
- [ ] **37. Basic-auth comparison is not constant-time** —
      `src/proxy.ts:72` uses `!==` for the pre-launch gate; use
      `crypto.timingSafeEqual`.
- [ ] **38. `MAX_COINS_PER_PROJECT` applies per phase** —
      `spendCoins` caps each phase at 250 (`src/lib/hours.ts:257-260`), so one
      project can mint up to 500 spendable coins, though
      `config/program.ts:22-28` describes it as a per-project ceiling. Confirm
      which is intended.

---

## 5. Already tracked, still open

- [ ] `LAUNCH_FIXES.md` #13 — `export/participants` returns email + slackId to
      any export key (see item 14 above).
- [ ] `LAUNCH_FIXES.md` #14 — rotate and delete `.env.old`; secrets in the
      working tree (see item 15 above).
- [ ] `todo.md` — external-only steps: register the Ari callback URL and
      secrets; set `RESEND_API_KEY` + `EMAIL_FROM` (notifications no-op
      without them); HCB OAuth app and rotated refresh-token persistence;
      `SLACK_REVIEW_CHANNEL_ID` if dispute notices are wanted.

---

## 6. Confirm before launch (external/config)

These are not code bugs, but each one silently degrades the product if missed.
The one-time setup list is `docs/RUNBOOK.md:6-112`; the differences worth
checking:

- **One canonical host.** `slack-app-manifest.yml:54,60` points Slack at
  `https://halflife.hackclub.com`, while `docs/RUNBOOK.md` uses
  `half-life.k.hackclub.dev` throughout. OAuth redirect URIs, `BETTER_AUTH_URL`,
  `NEXT_PUBLIC_APP_URL`, the Ari webhook URL and the Slack request URLs must all
  agree — a mismatch breaks sign-in, jobs or webhooks at the worst time.
- **Slack app:** create from the manifest (blocked by item 1 until fixed),
  invite the bot to all four channels, set all `SLACK_*` ids.
- **Ari:** program id + signing secret + webhook secret, webhook registered,
  `ari-retry` job running (the retry job currently reports success when Ari is
  unconfigured, so a missing secret looks green).
- **R2:** bucket, token, public domain, `NEXT_PUBLIC_UPLOAD_HOST`, and the
  Docker build-arg issue in item 26.
- **Email:** verify the sending domain; an unset provider makes item 18 look
  fine in ops.
- **Signup sink:** point `SIGNUP_WEBHOOK_URL` at a real provider — the
  `./data/signups.jsonl` fallback is not durable on a container filesystem and
  the `data/` directory may not even be writable by the non-root runtime user.
- **Landing facts** (`README.md:143-150`): confirm the EIN and decide on the
  mailing address; carousel credits are already real names.
- **Backups + alerting:** daily backup schedule, notification channels, and one
  proven restore, per the runbook.
