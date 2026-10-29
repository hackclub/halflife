# HCB grant cards

Status: implementation plan.

Bulk-issue HCB card grants to approved Half Life projects, with HCB replacing the Airtable/YSWS payout pipeline.

## Summary

Admins get a **Grants** page with one button that previews every approved project, then creates one HCB card grant per project for the exact BOM total. Each issuance is recorded, auditable, resumable and safe to retry after a lost HCB response.

The existing Airtable integration stays for submission evidence, review status and Loops emails. It stops being the thing that pays makers: the YSWS pipeline must not pay a design once HCB owns payouts.

## What already exists

There is already an HCB v4 client and a manual payout path, but no card creation and no bulk action.

- `src/lib/hcb.ts` – authenticated v4 client with token refresh, top-up, owner lookup, disbursement reads and transaction memos.
- `src/lib/grants.ts` – sends a manual top-up to an **existing** HCB card grant, one project at a time.
- `/api/admin/theme-projects/[id]/grant` – the admin route for that top-up.
- `HcbGrantTopUp` – idempotency and audit record for top-ups.
- `src/app/(platform)/(ops)/admin/users/[id]` – the current manual “Send grant” UI.

What is missing:

- creating HCB card grants,
- bulk issuance,
- batch progress and retry state,
- reconciliation for a create whose response was lost,
- a cutover away from Airtable payouts.

## Decisions

- **Funding decision:** design approved and a non-empty BOM.
- **Granularity:** one HCB card grant per project.
- **Amount:** exactly the BOM total, not `grantUsd`.
  - `bomTotalUsd(bomItems, bomTaxShippingUsd)`
  - sum of `quantity × unitCostUsd`, plus tax and shipping
  - converted with `Math.round(totalUsd * 100)`
  - `grantUsd` is stored for audit context only and is never the payment amount.
- **BOM over cap:** the BOM amount is paid even when it exceeds `grantUsd`. If a cap is wanted later, add `Math.min(bomTotalUsd, grantUsd)` in one place.
- **Empty BOM:** excluded.
- **Existing top-ups:** a project with a sent `HcbGrantTopUp` is excluded. The table stays for history.
- **No cards have been sent yet.** This is a clean start for `HcbGrantCard`; the only historical payout path to audit is Airtable/top-up.

The BOM total is already the figure written to Airtable as `Requested funding` (`fieldsFor` in `src/lib/airtable/sync.ts`), so paying the BOM from HCB preserves the amount the payout team has been seeing.

## Cutover from Airtable payouts

The Airtable `YSWS Project Submission` rows are still useful. They carry the evidence, Ari status, reviewer notes and Loops columns. They must stop carrying a payable amount.

### Payout source switch

Add a payout source to `ProgramSettings`:

```prisma
native_enum PayoutSource {
  AIRTABLE
  HCB
}

model ProgramSettings {
  // ...
  payoutSource PayoutSource @default("AIRTABLE")
}
```

Update:

- `src/lib/program.ts` – interface and converter.
- `src/lib/schemas/admin.ts` – `programSettingsSchema`.
- `ProgramSettingsForm` and `/admin/program`.
- `src/lib/airtable/sync.ts` – `fieldsFor` writes `requestedFunding: 0` for a design when `payoutSource === HCB`; a build already writes `0`.
- `src/app/api/admin/program/route.ts` – audit the change with before/after values.

`airtableSyncEnabled` keeps its current meaning: whether Airtable rows and Loops columns are written at all. The payout source is separate, so turning off Airtable payouts does not stop review and email.

### Cutover order

1. Confirm with the YSWS/payout owner which Airtable field gates payment. In this codebase it is `Requested funding`, but the pipeline itself is outside this repository.
2. Pause the YSWS payout automation for Half Life.
3. Set `payoutSource = HCB`.
4. Backfill existing approved design rows to `requestedFunding: 0`, or otherwise mark them non-payable in the pipeline. Do this before issuing cards.
5. Audit historical payments:
   - every design-approved project,
   - every `HcbGrantTopUp` row,
   - every Airtable/pipeline payment record the payout team can provide.
   Exclude any project already paid by either path.
6. Issue a single test card grant.
7. Enable bulk issuance.

If the pipeline cannot be paused or the gating field cannot be confirmed, do not enable bulk issuance. Two payout systems running at once is the one failure this plan cannot fix after the fact.

### Airtable audit trail

Optional but recommended: ask ops to add two columns to `YSWS Project Submission`:

- `Payout - Method` (`HCB` or `YSWS`)
- `Payout - HCB Card Grant ID`

The app can write them after a card is issued, giving the base a per-project trail without making it the payment source. If the columns are not added, the local `HcbGrantCard` row and audit log remain the source of truth.

### Legacy top-up path

When `payoutSource === HCB`:

- hide the manual “Send grant” form on `/admin/users/[id]`,
- refuse `sendGrant` for a project that already has a live `HcbGrantCard`,
- keep existing `HcbGrantTopUp` rows readable.

A top-up remains an HCB payment, so leaving it available alongside card issuance would create a second way to pay the same project.

## HCB v4 contract

### Create a card grant

```http
POST /api/v4/organizations/{org_slug}/card_grants
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "amount_cents": 3050,
  "email": "maker@example.com",
  "purpose": "Half Life parts – HL:<projectId>",
  "instructions": "Parts funding for <project title>.",
  "invite_message": "Your Half Life parts grant is ready."
}
```

Important behaviour:

- Requires the `card_grants:write` scope.
- Draws the amount from the organisation’s balance.
- A recipient without an HCB account gets an invitation instead of an existing card.
- `card_id` is `null` until the recipient activates the card. This is not a failure.
- Validation and insufficient balance return **422**, not 400.
- `201` returns the created card grant: `id`, `email`, `amount_cents`, `status`, `card_id`, `purpose`, `created_at`, `disbursements`.

### Other calls

| Call | Purpose |
|---|---|
| `GET /api/v4/organizations/{slug}` | Read `balance_cents` for preflight |
| `GET /api/v4/organizations/{slug}/card_grants` | Reconcile a create whose response was lost |
| `POST /api/v4/card_grants/{id}/cancel` | Cancel a grant and return the remaining balance |
| `GET /api/v4/card_grants/{id}` | Read one grant’s current status |

The docs are community-maintained, so treat the HCB source as the final authority for field names and status values.

### Request fields

- `amount_cents` – the BOM total in cents.
- `email` – the maker’s HCA email.
- `purpose` – stable marker used for reconciliation:
  `Half Life parts – HL:<projectId>`.
- `instructions` – human-readable, names the project.
- `invite_message` – shown in the HCB invitation email.
- No merchant lock, category lock, keyword lock, one-time use or pre-authorisation in v1.
- No `expiration_at` in v1. Expiry is a policy decision, not a default.

## Data model

Add to `prisma/contract.prisma`:

```prisma
native_enum HcbGrantCardStatus {
  PENDING
  ISSUED
  FAILED
  AMBIGUOUS
  SKIPPED
  CANCELED
}

native_enum HcbGrantCardBatchStatus {
  PROCESSING
  COMPLETED
  PARTIAL
  FAILED
}

model HcbGrantCardBatch {
  id              String                  @id @onCreate(cuid(2))
  status          HcbGrantCardBatchStatus @default("PROCESSING")
  fingerprint     String
  totalCents      Int
  issuedCount     Int                     @default(0)
  failedCount     Int                     @default(0)
  ambiguousCount  Int                     @default(0)
  skippedCount    Int                     @default(0)
  createdById     String?
  createdAt       TimestampString(3)      @default(now())
  completedAt     TimestampString(3)?
}

model HcbGrantCard {
  id              String                @id @onCreate(cuid(2))
  batchId         String
  userId          String
  themeProjectId  String
  phase           Phase                 @default("DESIGN")
  email           String
  amountCents     Int
  grantUsdCents   Int?
  bomLineCount    Int?
  status          HcbGrantCardStatus    @default("PENDING")
  hcbCardGrantId  String?
  hcbStatus       String?
  cardId          String?
  disbursementId  String?
  purpose         String?
  error           String?
  claimedAt       TimestampString(3)?
  issuedAt        TimestampString(3)?
  canceledAt      TimestampString(3)?
  supersededAt    TimestampString(3)?
  createdAt       TimestampString(3)    @default(now())

  @@index([themeProjectId, phase], map: "hcb_grant_card_project_phase_live_key", unique: true,
    where: sql`("status" IN ('PENDING', 'ISSUED', 'AMBIGUOUS'))`)
  @@index([hcbCardGrantId], map: "hcb_grant_card_hcbId_key", unique: true)
  @@index([batchId, status], map: "hcb_grant_card_batchId_status_idx")
  @@map("hcb_grant_card")
}
```

Add relations:

- `ThemeProject.hcbGrantCards`
- `User.hcbGrantCards`
- `HcbGrantCardBatch.cards`
- `HcbGrantCard.batch`, `.user`, `.themeProject`

Add a batch relation to `HcbGrantCard` with an index on `batchId`.

Why this shape:

- A batch is one button press: one total, one outcome summary.
- A card row is one attempt. A failed attempt stays attached to the batch that failed; pressing Issue again creates a fresh attempt.
- The partial unique index prevents two live grants for one project, even across two batches or two admin tabs.
- `hcbCardGrantId` is unique so one HCB grant cannot be claimed twice.
- Failed and skipped attempts do not block a retry. Issued and ambiguous attempts do.
- `supersededAt` leaves room for a confirmed reissue after cancellation without losing history.

Also add:

- `AuditAction.ADMIN_ISSUE_GRANT_CARD`.
- `AuditAction.ADMIN_CREATE_GRANT_CARD_BATCH`.
- `AuditAction.ADMIN_CANCEL_GRANT_CARD`.
- New relation names to the omit list in `src/lib/provisioning.ts`.
- New rows counted in `src/lib/project-delete.ts`.

After editing the contract:

```bash
bun run db:generate
bun run db:plan --name hcb_grant_cards
bun run db:migrate
bun run db:verify
```

## Server modules

### `src/lib/hcb.ts`

Reuse `hcbFetch`, the token cache and the timeout handling. Add:

- `createCardGrant(input)` – POST the organisation card grant, parse `201`.
- `listOrganizationCardGrants()` – GET the organisation’s grants.
- `readOrganizationBalanceCents()` – GET the organisation and read `balance_cents`.
- `cancelCardGrant(id)`.
- A `CardGrant` zod schema for the create and list responses.
- A `CardGrantIssueList` type, mirroring `GrantDisbursementList`:
  - `listed`
  - `unreadable`

`unreadable` and “no match” must not be the same answer. An unreadable list means a human has to look; it never means “safe to retry”.

### `src/lib/grant-cards.ts`

A new server-only module, separate from `grants.ts`.

#### `previewCardGrants()`

Returns:

- eligible projects: id, title, owner id, owner name, email, theme, BOM total, BOM line count, `grantUsd`.
- excluded projects grouped by reason:
  - design not approved
  - no BOM
  - BOM total is zero
  - no `grantUsd`
  - identity not verified
  - fraud flagged
  - already sent through `HcbGrantTopUp`
  - existing live `HcbGrantCard`
  - already paid by the Airtable pipeline
- total cents
- fingerprint
- HCB configuration and balance state

The fingerprint is a SHA-256 over sorted `projectId:amountCents:email` rows. The batch endpoint recomputes it, so a stale preview cannot issue a changed amount.

#### `createCardGrantBatch({ adminId, fingerprint })`

One transaction:

1. Recompute the preview.
2. Compare the fingerprint.
3. Create the batch.
4. Insert one `PENDING` row per eligible project.
5. Return the batch id.

The partial unique index is the final guard if two admins create batches simultaneously.

#### `processCardGrantBatch({ batchId, adminId })`

Process a small chunk, around 5–10 projects per call.

For each row:

1. Claim it with a compare-and-set on `claimedAt`. Refuse a row claimed within the last 10 minutes.
2. Re-read the project.
3. Re-check: design approved, BOM unchanged, maker verified, not fraud flagged, no sent top-up, no live sibling.
4. Recompute the BOM total. If it differs from `amountCents` by one cent, fail closed.
5. Call `createCardGrant`.
6. Validate the response:
   - `amount_cents` matches.
   - `email` matches the maker, case-insensitively.
   - `id` is present.
7. On mismatch, attempt `cancelCardGrant`, mark the row `AMBIGUOUS` or `FAILED`, and audit loudly.
8. On success, mark `ISSUED`, store the HCB id, status, card id and disbursement id.
9. Write the audit row in the same transaction as the `ISSUED` update.

Do not auto-retry the POST.

#### Lost response reconciliation

On timeout, network failure or 5xx:

1. Call `listOrganizationCardGrants()`.
2. Match on email, amount, purpose marker and `created_at` no earlier than the attempt minus five minutes.
3. Exactly one match: mark `ISSUED` and record the HCB id.
4. No match: mark `FAILED`, retryable.
5. More than one match, a missing timestamp or an unreadable list: mark `AMBIGUOUS`.

`AMBIGUOUS` requires a human or an explicit “Check again” action. It never becomes a retry.

#### Cancellation

`cancelCardGrantIssue`:

- calls HCB cancel,
- records `CANCELED` and `canceledAt`,
- writes an audit row.

Add a guard in `review.unapprovePhase`: refuse to un-approve a design while a live `ISSUED` card grant exists, and tell the admin to cancel the grant first. This mirrors the existing in-flight top-up guard in `src/lib/review.ts`.

## API routes

| Route | Purpose |
|---|---|
| `GET /api/admin/grant-cards/preview` | Eligible/excluded projects, total, fingerprint, HCB balance |
| `POST /api/admin/grant-cards/batches` | Create a batch from a fingerprint |
| `POST /api/admin/grant-cards/batches/[id]/process` | Process the next chunk and return progress |
| `POST /api/admin/grant-cards/batches/[id]` | Read batch progress for polling |
| `POST /api/admin/grant-cards/[id]/reconcile` | Re-check an `AMBIGUOUS` row against HCB |
| `POST /api/admin/grant-cards/[id]/cancel` | Cancel a live grant |

All use `withWritePermission(Permission.MANAGE_CREDIT, ...)`.

`process` gets `maxDuration = 60`. The client calls it repeatedly until no rows remain. That stays under the Cloudflare 100-second ceiling and makes a closed tab resumable.

## Admin UI

New page: `/admin/grants`, linked in `src/app/(platform)/(ops)/admin/layout.tsx` under `MANAGE_CREDIT`.

Add `MANAGE_CREDIT` to the layout’s `requireAnyPermissionPage` list.

Sections:

1. **HCB status** – configured or not, org slug, current balance, payout source, last batch.
2. **Ready to issue** – project, maker, theme, BOM total, BOM line count, and `grantUsd` for comparison.
3. **Excluded** – counts and reasons, with links to the project.
4. **Issue button** – opens a confirmation modal showing:
   - number of card grants,
   - exact total,
   - HCB balance,
   - a warning that HCB emails each recipient,
   - a statement that one card is created per project.
5. **Progress** – processed / total, amount issued, failures, ambiguous rows, per-row HCB links.
6. **Recent batches** – creator, time, total, issued/failed/ambiguous/skipped, resume action.

Client component: `src/app/components/forms/IssueGrantCardsForm.tsx`, using `useAction`, `sendJsonParsed`, `Modal`, `Table`, `Callout` and `Badge`.

Update `/admin/users/[id]` and the project row so a project shows “card grant issued” beside the existing “grant sent” top-up state.

### Confirmation copy

The modal should say, in substance:

> This creates N HCB card grants totalling $X, one per project, from the HCB balance of $Y. HCB emails each recipient. Projects already paid by top-up or card grant are not included.

Do not make this a single unlabelled button.

## Safety and edge cases

- **Double payment with Airtable** – the cutover section is a precondition, not a suggestion.
- **Double payment with the legacy top-up** – exclude sent top-ups and hide the manual form under `payoutSource = HCB`.
- **One live grant per project** – partial unique index plus application checks.
- **Identity and fraud** – fresh `isIdentityVerified` and `fraudFlagged` checks immediately before each create. Memoise verification per user within a process call so a maker with several projects is not checked several times.
- **BOM immutability** – the BOM locks after design approval, but still recompute and fail closed on any difference.
- **Invitations** – `card_id: null` is normal. The grant is issued; the recipient has not activated a card yet.
- **Owner mismatch** – cancel immediately and surface the row as ambiguous if HCB reports a different email.
- **Rate limits** – process sequentially or with concurrency 2. Never auto-retry a create on 5xx.
- **Token rotation** – HCB rotates refresh tokens. A long batch can outlive the cached token. Persist the rotated token in production, and let the admin resume if a run fails.
- **Permissions and PII** – `MANAGE_CREDIT` is ADMIN-only by default. Emails stay on admin surfaces.
- **Audit** – one row per issued grant with batch id, project id, amount, email, HCB grant id and card id.
- **Expiry** – omitted in v1.
- **Cancellation** – cancelling returns the remaining balance to the organisation. Record it; do not silently delete the row.

## Tests

### Unit

`src/lib/hcb.test.ts`

- create response parsing,
- 422 mapping,
- email mismatch,
- reconcile landed / absent / multiple / unreadable / undated.

`src/lib/grant-cards.test.ts`

- BOM total to cents,
- tax and shipping included,
- zero or empty BOM excluded,
- design not approved excluded,
- already topped-up excluded,
- fingerprint changes when amount or email changes,
- one live grant per project.

### Database

- two concurrent batch creations produce one live row for a project,
- two process calls do not both call HCB for the same row,
- a failed row can be retried,
- an issued row cannot be reissued,
- an ambiguous row blocks a retry until reconciled.

### Mock HCB run

With `HCB_BASE_URL` pointed at a local fixture server:

- `201` success,
- timeout after creation; reconciliation marks it issued,
- `422` insufficient balance,
- invitation response with `card_id: null`,
- owner email mismatch cancels and marks ambiguous.

### Commands

```bash
bun run typecheck
bun run lint
bun test --conditions=react-server src
bun run build
```

## Rollout

1. Confirm the Airtable payout gate with the pipeline owner.
2. Add HCB scopes and confirm `HCB_ORG_SLUG`, balance and refresh-token persistence.
3. Ship schema, HCB client and preview with bulk issuance disabled.
4. Set `payoutSource = HCB` in staging and pause the staging pipeline.
5. Backfill staging Airtable rows to zero and issue one card grant.
6. Verify the HCB card, invitation, local row and audit row.
7. Repeat in production: pause pipeline, switch source, backfill, issue one.
8. Enable bulk issuance.
9. Keep the legacy top-up route read-only for history.

## Definition of done

- `/admin/grants` previews approved projects and excludes every ineligible one with a reason.
- The amount shown and issued is the BOM total, including tax and shipping.
- One card grant is created per project, exactly once.
- A double click, two tabs or a retried request cannot create a second grant.
- A lost HCB response is reconciled before any retry.
- Every issue writes an audit row with the HCB grant id.
- Airtable no longer carries a payable amount for Half Life designs.
- The manual top-up path cannot pay a project that already has a card grant.
- The admin can resume a batch, reconcile an ambiguous row and cancel a grant.

## Open items

- Which exact Airtable field or automation must be cleared to stop the YSWS pipeline paying.
- Whether any historical design has already been paid by the Airtable pipeline.
- Whether to add `Payout - Method` and `Payout - HCB Card Grant ID` columns to the Airtable base.
- Whether a BOM total above the tier cap should be paid in full or capped at `grantUsd`.
- Whether card grants should expire at the end of the season.
- Where to persist the rotated HCB refresh token in production.
