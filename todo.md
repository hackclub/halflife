# Half Life — open work, prioritised

The items from the original notes, reordered by what blocks launch versus what
improves it. Each item names the current state in the code so it can be picked
up cold, and flags the decisions that are not mine to make.

**Effort:** S ≈ under a day · M ≈ a few days · L ≈ a week or more.

| # | Item | Priority | Effort | Blocked on |
| --- | --- | --- | --- | --- |
| 1 | Register the Ari callback URL | **P0** | S | Ari program config |
| 2 | Notify participants of review outcomes | **P0** | M | email provider choice |
| 3 | Submission state across the projects UI | **P1** | M | colour/legend decision |
| 4 | Review actions on the project page | **P1** | M | dispute semantics |
| 5 | Project placeholder from a reel or devlog | **P2** | S | — |
| 6 | Send grants from the admin panel (HCB) | **P3** | L | HCB OAuth app + grant mapping |

---

## P0 — Launch blockers

### 1. Register the Ari callback URL

**Goal.** Ari can reach Half Life's webhook so review decisions flow back.

**Current state.** The route is already built: `POST /api/integrations/ari/webhook`
(`src/app/api/integrations/ari/webhook/route.ts`) — HMAC-verified with
`ARI_WEBHOOK_SECRET`, idempotent by `delivery_id`, and already excluded from
basic auth by `src/proxy.ts` (`api/integrations`). The three secrets are
documented in `.env.example`.

**Work.**
- Register `https://<host>/api/integrations/ari/webhook` in the Ari program, and
  set `ARI_PROGRAM_ID`, `ARI_SIGNING_SECRET`, `ARI_WEBHOOK_SECRET`.
- Create the `ari-retry` Orchard job (documented in `docs/RUNBOOK.md`) so a
  failed send is replayed.
- Smoke-test: an unsigned delivery → `400`, an unconfigured server → `503`, a
  signed delivery → `204`.
- Nice-to-have: show the callback URL and its configured/unconfigured state on
  `/admin/program` so an operator does not have to read the env.

**Open.** Exact location of the webhook URL field in the Ari program settings.

---

### 2. Notify participants of review outcomes

**Goal.** When a phase is approved, returned, or rejected — whether Ari or the
console made the call — the maker hears about it by **email and Slack DM**.

**Current state.** There is no notification path at all. `finalizeReview`
(`src/lib/review.ts`) is the single decision entry point for both Ari
(`applyAriWebhook`, `src/lib/ari.ts`) and the console
(`/api/review/submissions/[id]/decision`). Slack helpers already exist and are
unused: `sendDM` / `postMessage` in `src/lib/slack.ts`. There is **no
transactional email provider** — the only email code is the Airtable → Loops
marketing sync, which is not for this.

**Work.**
- New `src/lib/notifications.ts` with
  `notifyReviewOutcome({ userId, themeProjectId, phase, result, feedback })`,
  best-effort, writing an audit row on failure the way `trackSideEffect` does.
- **Slack:** `sendDM(user.slackId, text)`, skipped when there is no `slackId` or
  no `SLACK_BOT_TOKEN`. The bot needs `im:write` (already in the manifest).
- **Email:** choose a provider (Resend, or Hack Club's transactional mail), add
  `lib/email.ts` plus `EMAIL_API_KEY` / `EMAIL_FROM`, and a short template
  linking to the project.
- Fire **after** the decision transaction commits, from both the Ari webhook
  `on_event` and the console decision route — never inside the transaction.
- Make it idempotent per `(submission, result)` so an Ari redelivery cannot
  double-notify.

**Decisions.** Provider; confirm `changes` notifications are wanted (they are,
by default); copy.

---

## P1 — Participant experience

### 3. Submission state across the projects UI

**Goal.** See at a glance which projects are approved, in review, need changes,
or were rejected.

**Current state.** `ProjectsGrid.tsx` renders each project as a
`<Panel tone="line">` with no review colour. The snapshot already carries
`phaseStatusByWeek` (`src/lib/queries/store.ts`) and a `weekId` per project;
`useStore().stateOf(weekId)` already returns the phase status.

**Work.**
- Surface the phase status on the `Project` snapshot (`queries/store.ts` and
  `src/lib/types.ts`) rather than making the grid re-derive it.
- Colour the card border by state in `ProjectsGrid.tsx`. **Use the platform's
  own tokens, not literal green/blue/amber/red** — DESIGN.md's "State Colour
  Rule" and measured contrast already map these: approved → `teal`,
  in review → `sky`, needs changes → `orange`, rejected → `coral`. Add a small
  legend so the colours are learnable.
- On the project page (`ProjectDetail.tsx`), add a review-state block **above**
  the `<RepoChecks>` component (~line 186) showing each phase's status, the
  review comments, and when it was decided.

**Decision.** A project has two phases (design, build). Recommend per-phase
chips rather than one overall colour, so "design approved, build in review" is
legible.

---

### 4. Review actions on the project page

**Goal.** When a phase needs changes, the maker has a way to respond instead of
being stuck.

**Proposed actions.**
- **"I've made these changes — resubmit"** — deep-links the submit sheet. No
  new backend: a returned phase is already `update_requested` and
  `canSubmitPhase` (`src/lib/submissions.ts`) already lets it be resubmitted.
- **"This review is incorrect — the project works as intended"** — a *dispute*.
  Recommend it does **not** change state: it flags the submission for an admin
  and notifies staff, so a reviewer's decision is not silently overridden by a
  button.

**Work.** A `ReviewDispute` row (or a flag + audit action) and
`POST /api/projects/[id]/dispute`; surface pending disputes in the console;
copy that reads honestly (a second look, not an auto-approve).

**Decision.** Dispute semantics and who is notified. The original note said
"Other idk" — this is the open product question, not an implementation one.

---

## P2 — Polish

### 5. Project placeholder from a reel or devlog

**Goal.** A project with no chosen cover still shows real work.

**Current state.** `src/lib/thumbnail.ts` `projectThumbnail()` already falls
back to the **newest image in the journal**. `getStoreSnapshot` passes only the
journal sessions, and reels carry `Post.thumbnailKey` / `objectKey`.

**Work.**
- Extend the fallback chain to: chosen cover → newest journal image → newest
  reel frame.
- Reel thumbnails may be null (there is no transcoding step), so either add a
  small thumbnail generator, or let the grid render the image slot as a muted
  `<video preload="metadata" src="…#t=0.1">` when only a video key exists.
  Recommend trying `thumbnailKey` first and only falling back to `<video>`.

**Effort.** S.

---

## P3 — Ops automation

### 6. Send grants from the admin panel (HCB)

**Goal.** A button in the admin panel that pays out a participant's grant.

**Key finding — the linked API will not work.** The HCB **v3** API
(`https://hcb.hackclub.com/docs/api/v3`) is **read-only and unauthenticated**:
it only reads public data from organisations with Transparency Mode on. There
are no keys and no writes, so it cannot send grants.

The authenticated write API is **v4**, as used by
[`hackclub/dinobags`](https://github.com/hackclub/dinobags):

```
POST https://hcb.hackclub.com/api/v4/card_grants/{hashid}/topup?expand=disbursements,user
     { "amount_cents": 3000 }
PUT  https://hcb.hackclub.com/api/v4/organizations/{slug}/transactions/{txn_id}
     { "memo": "[grant] …" }
```

Auth is an **OAuth bearer token** (`POST /api/v4/oauth/token`, refresh-token
grant), with the OAuth app invited to the HCB org as a **manager**. A grant's
`hashid` is the short id in its URL (`https://hcb.hackclub.com/grants/nZIQ6K`).

**Work (phased).**
1. **Spike, external:** register the HCB OAuth app, get a refresh token, and
   top up a $1 grant on a test org to prove the flow.
2. **Connection:** env + a credentials row with the token, refreshed on `401`
   exactly as dinobags does.
3. **Grant mapping (the hard part):** decide where a participant's grant
   `hashid` comes from. Either a field the maker pastes (a grant URL, the
   dinobags pattern), or the existing unified payout pipeline. This is the main
   unknown and should be settled before UI work.
4. **Admin UI:** a "Send grant" action on an approved project (or a Grants tab
   under `/admin`), gated on `MANAGE_CREDIT`, with a confirmation showing the
   amount. Amount comes from the frozen tier (`grantUsd`, `SubmissionReview`).
5. **Idempotency / audit:** an `HcbGrantTopUp` row keyed on
   `(userId, themeProjectId, phase)` plus an audit action, so a double-click or
   a retry can never pay twice.

**Decisions.** Whether Half Life or the existing Airtable/YSWS pipeline owns
payouts; the grant-hashid source; whether the participant must create an HCB
grant card first.

---

## Cross-cutting decisions

- **Transactional email provider** — nothing exists today; item 2 is blocked on
  choosing one.
- **State colours** — use the platform tokens (teal / sky / orange / coral), not
  literal green/blue/amber/red, per DESIGN.md.
- **Notifications from both paths** — the console and Ari both resolve through
  `finalizeReview`, so hooking notifications there covers both; confirm that is
  wanted.
- **Payout ownership** — item 6 duplicates, in part, what the Airtable/YSWS
  pipeline already does. Decide before building.

## Already done (context)

- **Ari round-trip** — ships are sent on submit and withdrawn on unsubmit;
  webhooks are verified, idempotent, and applied through `finalizeReview`;
  `ari-retry` replays failed sends. Only registration (item 1) remains.
- **Identity and avatars** — HCA identity + Slack id, with profile pictures read
  through Cachet (`src/lib/avatar.ts`).

---

<details>
<summary>Original notes</summary>

- Callback URL for Ari
- Project approval (when done in Ari) should notify the user
  - By email and by Slack DM
- Indicate submission state on the projects page for each project
  - Green border = approved
  - Blue border = submitted, not reviewed
  - Yellow/orange/amber border = reviewed, needs changes
  - Red border = rejected
  - Also display state and extra review info on the project page
    - Display above repo checks section
    - Multiple choice for options
      - "I have made these changes, resubmit"
      - "This review is incorrect, project works as intended" or similar
      - Other idk
- A button in the admin panel to send out grants
  - Use the HCB API at https://hcb.hackclub.com/docs/api/v3
    - we need to find an authenticated version of this that allows for sending out grant cards
- Placeholder image for project should be a screenshot from a reel or image from a devlog

</details>
