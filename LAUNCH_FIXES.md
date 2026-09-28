# Pre-launch fixes

Bugs found in the launch review, ranked. Check off as each lands. Each item
should get its own `pnpm typecheck && pnpm lint` pass (and `pnpm build` for the
larger ones) before it is ticked.

## High — launch blockers

- [x] **1. `fulfillOrder` / `rejectOrder` race: refund *and* shipment on one order**
  - `src/lib/shop.ts:252-275` — `fulfillOrder` reads the status, then does an
    unconditional `shopOrder.update(... FULFILLED)`. It does not take the
    per-user credit lock that `rejectOrder` (`src/lib/shop.ts:198-249`) holds, so
    a concurrent reject can refund the coins and the fulfill still commits.
  - `src/app/api/admin/shop/orders/[id]/decision/route.ts:60-71` — the `ON_HOLD`
    branch has the same stale-read-then-unconditional-update shape.
  - Fix: take `lockUserCredit(tx, order.userId)` inside a transaction in
    `fulfillOrder`, re-read the status under the lock, and write with a
    conditional `updateMany` as a second guard. Make the `ON_HOLD` update
    conditional on the status that was just read.

- [ ] **2. Cover-image ownership check bypassable with `..`**
  - `src/app/api/projects/[id]/route.ts:93` uses
    `data.coverImageKey.startsWith(\`covers/${gate.user.id}/\`)` with no
    traversal guard, and `coverImageKey` is an unconstrained string
    (`src/lib/schemas/project.ts:9`).
  - Fix: reject `..` (reuse `isOwnedKey()` from `src/lib/uploads/r2.ts`, which
    already refuses it) in addition to the folder prefix.

- [ ] **3. Landing signup form cancels the request it means to let finish**
  - `src/components/site/signup-form.tsx:113-135` passes an `AbortController`
    signal to `fetch("/api/subscribe")` and aborts at 2.5s. `keepalive` cannot
    survive an explicit abort, so slow signups lose their email, referrer and
    UTMs.
  - Fix: drop the abort signal (keep `keepalive`), or do not abort — let the
    request finish on its own as the comment claims.

- [ ] **4. Hero scroll cue renders as an empty, nameless link**
  - `src/components/site/hero.tsx:462-480` — the `<a href="#how-it-works">`
    contains only a JSX comment; no text is ever rendered. Two instances
    (`:324`, `:398`).
  - Fix: render the label the comment describes (e.g. a `<span>scroll</span>`
    and the rest of the phrase), matching the `label`/letter-spacing intent.

## Medium

- [ ] **5. `BUILD_BANKED_HOURS` missing from `EARNING_KINDS`**
  - `src/lib/currency.ts:30-38`. `getEarnedCredit()` (`/api/me`,
    `/api/credits`, `queries/dashboard.ts`) drops the banked half of every
    approved build. Add `LedgerKind.BUILD_BANKED_HOURS`.

- [ ] **6. Sessions can be logged into an approved/rejected phase**
  - `src/app/api/projects/[id]/sessions/route.ts:72-75` blocks only `in_review`,
    unlike the edit route (`.../sessions/[sessionId]/route.ts:56-58`). Block
    `approved` and `rejected` too.

- [ ] **7. Internal costs shipped to participants**
  - `src/lib/shop.ts:59-65` spreads the whole `ShopItem`, leaking `costUsd`
    through `/api/shop/items` and the shop page; `src/app/api/shop/orders/route.ts:19-25`
    returns `unitCostUsd`.
  - Fix: select explicit public fields (`omit`/`select`).

- [ ] **8. Review claim not re-checked inside the decision transaction**
  - `src/lib/review.ts:143` validates the claim outside the `$transaction`
    (`:212`), which then deletes it (`:368`). Re-check `claim` after
    `lockUserCredit` inside the transaction.

- [ ] **9. Feed visibility gaps**
  - `src/lib/feed.ts:326-348` — `getComments` never checks the parent post's
    `status`/`deletedAt`.
  - `src/lib/feed.ts:261-281` — `recordView` counts views on hidden/deleted posts.
  - `src/lib/feed.ts:375-391` — `deleteOwnComment` filters `deletedAt` but not
    `hiddenAt`, double-decrementing `commentCount` for an already-hidden comment.

## Low

- [ ] **10. ISO-BMFF non-video passes the "actually a video" guard**
  - `src/lib/uploads/r2.ts:37-45` accepts any `ftyp` box (e.g. HEIC/AVIF).
    Tighten the brand check to the accepted video brands.

- [ ] **11. Dead Slack link on the shop page**
  - `src/app/(platform)/(app)/shop/page.tsx:27` — `href="#"`.

- [ ] **12. Hackatime panel can hang on network failure**
  - `.../projects/[id]/HackatimeLinks.tsx:54-80` — `load()` has no `try/catch`
    around its `fetch`es, so a failure leaves "checking hackatime…" forever.
    Add error state + retry, as the sibling loaders do.

- [ ] **13. `export/participants` returns email + slackId to any export key**
  - `src/app/api/integrations/export/participants/route.ts:29-51` contradicts
    its own comment. Confirm every `EXPORT_API_KEY` holder is trusted with the
    full roster, or scope the fields.

## Housekeeping

- [ ] **14. Secrets in the working tree**
  - `.env` and `.env.old` hold live-looking credentials (Slack token,
    HCA/Hackatime/Lapse secrets). Neither is tracked or in git history, but
    rotate and delete `.env.old` before the directory is shared or archived.
