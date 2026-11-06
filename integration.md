Verdict

The wire protocol is not the hard part. Ire's Ari-compatible edge already matches most of what Half Life sends and expects: paths, HMAC envelopes, 409 already_queued, withdraw shape, status phases, and outbound event names. The real work is making the integration safe to run beside Ari, not switching to it.

The right first step is a shadow sink:

• Half Life keeps sending every hand-in to Ari and keeps applying Ari's decisions exactly as today.
• Half Life also sends a copy to Ire.
• Ire runs its checks and shows a queue, but reviewers cannot claim or decide, and it sends nothing back.
• When a phase is resolved in Ari, Half Life withdraws the Ire copy so Ire's queue does not become a graveyard of stale ships.
• Cutover later becomes a config change, not a rewrite.

Do not repoint ARI_* at Ire. Add a separate IRE_* provider.

What already works

Area	State
Create path	Ire's POST /api/ingest/{program} matches the Ari SDK path, and program is the programme slug (half-life).
Withdraw	POST /api/ingest/{program}/withdraw matches; Ire returns {id,status}.
Status	GET /api/ingest/{program}/status matches, bearer-authenticated with the ingest secret.
Inbound signature	Ire accepts both timestamp.body and legacy body-only HMAC. Half Life's current Ari SDK sends body-only.
Conflict	Ire returns 409 {error:"already_queued",id,version}, which Half Life's existing adoption logic understands.
Status vocabulary	Ire maps its internal stages onto Ari's processing, review, under_review, second_pass, reviewed, withdrawn, reverted.
Outbound	Event names and timestamp.delivery_id.body signing match Ari's, so Half Life's existing webhook verifier can read it.
Ingest fields	Ire's contract accepts the fields Half Life sends, and additionally meta.bom, meta.hours, meta.prior_reviews.

The gaps that will bite

1. The Ari SDK cannot carry Ire's richer meta.
   @hackclub/ari's validateShip requires meta to be a flat object of at most 24 scalar keys, and explicitly rejects nested objects. Half Life cannot send meta.bom, meta.hours, or meta.prior_reviews through that SDK. Ire's own contract supports them.
   Recommendation: write a small src/lib/ire-platform.ts client for Ire, using fetch and WebCrypto, rather than reusing the Ari SDK. It also lets Ire use timestamped signatures instead of relying on legacy compatibility.
2. Ire's ingest cap is 1 MiB; Half Life's ships can be larger.
   Half Life sends up to 200 journal entries of up to 20,000 characters each, plus markdown and clip links. A prolific project can exceed 1 MiB. Ari's SDK allows 25 MB.
   Recommendation: raise Ire's maxIngestBody to a measured bound (8-16 MB), and add a payload-size guard in Half Life that reports a clear error rather than a silent send failure.
3. Ire has no read-only or shadow mode.
   Without one, a reviewer can claim and decide a shadow ship. The existing outbound_enabled column is not read anywhere, so setting it to 0 does not stop delivery. auditor memberships are not safe either: handleClaim does not check the role.
   Recommendation: add a deployment-level IRE_SHADOW flag, enforce it server-side on claim, heartbeat, release, draft, decision and send-back, suppress deliverDue and outbox writes, and expose readOnly to the UI. Also wire up or remove outbound_enabled.
4. unsubmitPhase deletes the local submission row.
   Any Ire id stored only on PhaseSubmission is lost. The existing Ari code gets away with it by withdrawing by external_id, but Ire's resubmission and stale-conflict handling needs to know which hand-in a remote ship belongs to.
   Recommendation: add a small IreShip mapping table keyed by (themeProjectId, phase), holding remoteId, version, lastSubmissionId, status, closedAt and lastError. It survives the deletion and makes the lifecycle explicit.
5. A shadow ship stays open after Ari decides.
   If the maker resubmits, Ire still holds the old open ship. A new create returns 409 already_queued, and adopting that id would show stale content. Half Life must withdraw the old Ire copy on resolution, and also before sending a new version.
   Recommendation: close shadow ships when the local phase leaves in_review; plus a submit-time withdraw when IreShip.lastSubmissionId is older than the submission being sent. Treat an unknown 409 id as a lost-response adoption, and a known stale id as withdraw-then-retry.
6. Live cutover needs provider-aware decision handling.
   Half Life's applyDecision looks up the local row by ariSubmissionId, defaultFeedback says "Approved by Ari", and notifyReviewOutcome only accepts "ari" | "console". In live mode, Ire's event carries its own submission id.
   Recommendation: defer this to the live phase, but design the new data model and webhook receiver so it can be added without another schema change.
7. Auth and hosting are not ready.
   Ire currently runs as ire.localhost, seeds fixtures and dev accounts by default, and has no roster UI. Testers need memberships, and Half Life needs a public HTTPS origin.

Proposed shadow architecture

flowchart LR
  Maker[Submit] --> HL[Half Life]
  HL -->|existing create + withdraw| Ari[Ari]
  HL -->|shadow create + withdraw| Ire[Ire]
  Ari -->|signed webhook| HLD[Half Life decision]
  HLD --> Money[finalizeReview: credit, Airtable, notifications]
  Rev -->|no outbound in shadow| Sink[no delivery]
  Job[ire-retry job] -->|close resolved copies| Rev

Key decisions:

• ARI_* remains untouched. Add IRE_API_URL, IRE_PROGRAM=half-life, IRE_SIGNING_SECRET, IRE_WEBHOOK_SECRET, IRE_MODE=shadow|live, and optionally IRE_BASE for UI links.
• Ire's IRE_INGEST_SECRET must equal Half Life's IRE_SIGNING_SECRET.
• Ire's outbound stays fake://receiver and outbound is disabled until the live phase.
• Half Life sends the same external_id (<projectId>:design|build) to both services.
• A IreShip row, not columns on PhaseSubmission, is the mapping.
• Shadow sends never notify the maker. Only Ari failures keep the existing maker notice behaviour.

Changes: Half Life

Area	Change	Main files
Client	New timestamped-HMAC Ire client: create, withdraw, status, later reviews?since. Parse 409 already_queued, 404 unknown ship, and Ire's {code,error,field} errors.	new src/lib/ire-platform.ts, src/lib/ire-url.ts
Payload	Extract the ship builder so both providers share one source. Add meta.bom, meta.hours, meta.prior_reviews, meta.requested_tier, meta.grant_cap_cents. Strip the nested fields when producing the Ari payload.	src/lib/ari.ts, new src/lib/review-ship.ts
Data	Add IreShip with themeProjectId, phase, externalId, remoteId, version, status, decision, lastSubmissionId, syncedAt, closedAt, lastError. Add Ire audit actions and a ire_ship sync-run key.	prisma/contract.prisma, migration, src/lib/side-effects.ts, src/lib/sync-run-log.ts
Send	On submit, warm-up import and dispute resubmit, dual-send to Ire when configured. On unsubmit, withdraw from Ire as well.	src/app/api/projects/[id]/submit/route.ts, src/app/api/projects/[id]/unsubmit/route.ts, src/lib/airtable/warmup-import.ts, src/lib/disputes.ts
Lifecycle	On resolve or revert, withdraw the shadow copy. Before a new submission, withdraw a stale copy identified by IreShip.lastSubmissionId.	new src/lib/ire-shadow.ts, submit path, retry job
Retry	New ire-retry job: replay unsent ships, replay failed withdrawals, close stale ships, verify open Ire ships still exist. ?dryRun=true supported.	new src/app/api/integrations/ire-retry/route.ts, jobs/steps/ire-retry.json, jobs/README.md
Admin	Separate Ire panel: configured, mode, host, send failures, unsynced rows, link to Ire queue. Do not fold Ire into Ari's pending count.	src/lib/queries/admin.ts, src/app/(platform)/(ops)/admin/program/page.tsx, new sync-to-ire route
Webhook	Optional shadow receiver on a separate path and secret. Verify, record, audit, return 200, never call finalizeReview while IRE_MODE=shadow.	new src/app/api/integrations/ire/webhook/route.ts
Scripts	ire-shadow-backfill.ts for the open queue, and ire-parity.ts to compare queue counts, checks, hours and BOM without writing.	scripts/
Contracts	Pin the Ire payload shape and the shadow lifecycle rules in verify:contracts.	scripts/verify-contracts.ts
Docs	.env.example, docs/BACKEND.md, docs/RUNBOOK.md, jobs/README.md.	as above

Changes: Ire

Area	Change	Main files
Shadow mode	Add IRE_SHADOW=1 to config. Return 409 shadow_mode on claim, heartbeat, release, draft, decision and send-back. Skip outbox writes and deliverDue.	app.go, wasm.go, queue.go, decision.go, outbox.go
Contract	Add readOnly to MeResponse (and generated Go types), and a banner in the layout.	web/src/lib/contract.ts, auth.go, contract/
UI	In read-only mode, do not auto-claim on queue or review open; hide the decision rail and decision keys; show "Shadow mode: decisions stay in Ari."	web/src/routes/+layout.svelte, queue/+page.svelte, review/+page.svelte, session.svelte.ts
Delivery	Actually enforce program.outbound_enabled, and skip outbox in shadow. This is currently dead code.	decision.go, outbox.go
Ingest limit	Raise maxIngestBody to a measured safe bound, with a test around Half Life's largest realistic payload.	ingest.go
Auth	Add a way to seed or invite reviewer/organiser memberships. Today only one bootstrap email can sign in, which is not enough for a pilot.	schema.go, hca.go, new admin/CLI path
Ops	Deploy to a real HTTPS host, disable fixtures, disable dev auth, set secrets, and document the callback URLs.	app.json, README.md

Phases

Phase 0 - Prerequisites

• A staging Ire deployment on a public HTTPS origin.
• IRE_INGEST_SECRET, IRE_OUTBOUND_SECRET, IRE_GITHUB_TOKEN, HCA credentials set.
• IRE_SEED_FIXTURES=0, IRE_DEV_AUTH=0.
• Testers seeded as members; bootstrap admin created.
• Ire's outbound_url pointed at fake://receiver.

Phase 1 - Ire becomes read-only

• IRE_SHADOW=1.
• Server guards, UI flag, outbox suppression.
• Tests prove a reviewer cannot claim, draft, decide or cause a delivery.

Phase 2 - Half Life dual-send

• New Ire client, shared ship builder, IreShip table.
• Submit/unsubmit/warm-up/dispute paths dual-send and withdraw.
• ire-retry job and admin panel.
• Backfill only the currently open queue.

Phase 3 - Shadow lifecycle and parity

• Close Ire copies when Ari resolves or reverts a phase.
• Handle resubmission: withdraw stale copy, create new version.
• Run ire-parity.ts over the open queue and explain check differences.
• Exit when queue counts match local open hand-ins, no stale ships, no Ire deliveries, and no changes to credit, Airtable or maker notifications.

Phase 4 - Optional inbound signature test

• Point Ire at a Half Life shadow webhook receiver, make one controlled decision, verify the signature and audit row, and confirm finalizeReview is never called.

Phase 5 - Later: live cutover

• Provider-aware decision application, Ire URL in notifications, generic delivery dedupe, and reviews?since reconciliation. Not part of the initial read-only test.

Test plan

• A captured Half Life ship is accepted by Ire's JSON schema and Go ingest.
• A payload with BOM, hours and prior reviews survives the round trip and shows in Ire.
• A 1 MB+ journal payload either succeeds after the cap change or is rejected with a clear Half Life error.
• Submit: ship appears in Ire; IreShip.remoteId and version are stored.
• Resubmit after a return: Ire gets a new version, not a stale 409.
• Unsubmit: Ire ship is withdrawn; a failed withdrawal is replayed by ire-retry.
• Ari decision: Ire copy is withdrawn; local credit, Airtable and notification behaviour are unchanged.
• Ire read-only: claim/decision endpoints return 409; queue and review pages do not auto-claim; no outbox rows.
• Disabled IRE_*: everything no-ops; Ari still works.
• Bad Ire HMAC, 5xx and timeout: audit row, retry, no maker DM.
• Shadow webhook (if enabled): verified, recorded, ignored, no finalizeReview.

Backfilling reviews

Ari's decisions already live in Half Life's `submission_review` rows, so no Ari access is needed. `bun run ire:backfill-reviewed` reads the newest resolved hand-in per project and phase, builds the ship with the normal builder and maps the review history onto Ire's `import-reviewed` endpoint. It is a dry run unless `--commit` is passed; `--limit=N` caps the pass and `--ari-only` keeps it to decisions Ari made. Re-running is safe because Ire skips ships that are already decided.

Rollback

Unset the IRE_* variables. All new code paths no-op, the new table stays empty or historical, and Ari remains the only decision path. Because the initial design dual-sends, Ari already has every ship and every decision, so there is no replay step and no database edit.

Effort

Roughly 1.5-2 weeks of focused work, excluding Ire's own deployment and roster work:

• Ire read-only mode and UI: 2-3 days.
• Half Life client, data model, dual-send and lifecycle: 4-6 days.
• Jobs, admin, parity and tests: 2-3 days.
• Ops and rehearsal: 1-2 days.

Decisions to confirm

1. Read-only means no decisions at all, not "decisions are recorded in Ire but not applied". I recommend the stricter version for the first test.
2. All currently open hand-ins plus all new submissions, not a sample. This gives a real parity signal, but it doubles ingest and GitHub check traffic.
3. A IreShip mapping table, not nullable Ire columns on PhaseSubmission. The table is safer because unsubmit deletes the local row.
4. A separate ire-retry job, not folding Ire into ari-retry, so a Ire outage cannot delay Ari.
5. Whether the initial test should include the signed inbound webhook, or stop at outbound-only shadow. I would leave the webhook receiver in the code but disabled until the decision application path is intentionally built.

One coordination note: the Ire working tree currently has uncommitted changes in ingest.go and an untracked identity.go, so the Ire-side work should avoid those areas until the other agent's changes land.