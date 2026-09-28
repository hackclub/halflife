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

- [x] **2. Cover-image ownership check bypassable with `..`**
  - `src/app/api/projects/[id]/route.ts:93` used
    `data.coverImageKey.startsWith(\`covers/${gate.user.id}/\`)` with no
    traversal guard, and `coverImageKey` is an unconstrained string
    (`src/lib/schemas/project.ts:9`).
  - Fix landed: the route now uses `isOwnedKey()` plus the `covers/` prefix.
    `isOwnedKey()` (`src/lib/uploads/r2.ts:205`) was also hardened to reject `%`
    alongside `..`, because a `%2e%2e` segment is a double-dot to the URL parser
    too — this hardens the feed, session-media and submission call sites at the
    same time. New cases added to `verify:contracts`.

- [x] **3. Landing signup form cancels the request it means to let finish**
  - `src/components/site/signup-form.tsx:101-125` — the `AbortController` +
    2.5s timeout was removed; the `/api/subscribe` fetch is now fire-and-forget
    with `keepalive: true` and a `.catch`, so it is never cancelled and never
    blocks the sign-in. `SUBSCRIBE_WAIT_MS` removed with it.

- [x] **4. Hero scroll cue renders as an empty, nameless link**
  - `src/components/site/hero.tsx:470-481` — added the visible `<span>scroll`
    (with the `-0.14em` trailing-letter-space correction the comment describes)
    and an `sr-only` " to see how it works", so the accessible name is
    "SCROLL TO SEE HOW IT WORKS". Verified in the browser: the word renders and
    the link's a11y name contains the on-screen label.

## Medium

- [x] **5. `BUILD_BANKED_HOURS` missing from `EARNING_KINDS`**
  - `src/lib/currency.ts:30-39`. `getEarnedCredit()` (`/api/me`,
    `/api/credits`, `queries/dashboard.ts`) drops the banked half of every
    approved build. Added `LedgerKind.BUILD_BANKED_HOURS` (the only earning kind
    that was absent; `PARTS_TOP_UP`, `SHOP_PURCHASE` and `SHOP_REFUND` are
    correctly excluded).

- [x] **6. Sessions can be logged into an approved/rejected phase**
  - The `POST` route blocked only `in_review`, unlike `PATCH`. Added a shared
    `isPhaseDecided()` helper (`src/lib/program.ts:296-306`) and applied the
    same "decided phase is frozen" guard to every write that touches a phase's
    hours/record:
    - `.../sessions/route.ts` POST (new entry)
    - `.../sessions/[sessionId]/route.ts` PATCH (now via the helper) and DELETE
      (delete was not guarded at all)
    - `.../hackatime/route.ts` POST (link adds hours; had no guard)
    - `.../hackatime/[linkId]/route.ts` DELETE (remove a link)

- [x] **7. Internal costs shipped to participants**
  - `getShopItemsFor` spread the whole `ShopItem` (`...item`), leaking `costUsd`
    to the client via `/api/shop/items` and the shop page's RSC payload. Now it
    uses an explicit `select` and a `ShopItemPublic = Omit<ShopItem, "costUsd">`
    type (`src/lib/shop.ts`).
  - Also found and fixed the purchase **response**: `purchase()` returned the
    full `ShopOrder` (with `unitCostUsd`) through `POST /api/shop/orders`, and
    `GET` returned full rows too. Added a shared `shopOrderPublicSelect` /
    `ShopOrderPublic` in `src/lib/shop.ts`, used by the `create` select and by
    both order-list and purchase responses — so `unitCostUsd`, the encrypted
    address/phone and `lastActorId` no longer leave the server.

- [x] **8. Review claim not re-checked inside the decision transaction**
  - `src/lib/review.ts` — the outer claim check (kept as a fast fail) is now
    backed by an authoritative re-read of `reviewClaim` inside the
    `$transaction`, after `lockUserCredit`, which throws `CLAIMED_BY_OTHER` if
    another reviewer's live claim appeared since the page was opened. The
    `resolvedAt` re-read already prevents a double payout.

- [x] **9. Feed visibility gaps**
  - `src/lib/feed.ts` — all three now use the shared `visible` filter / guard:
    - `getComments` looks the parent post up with `visible` and 404s if it is
      hidden or deleted.
    - `recordView` does the same before counting, so views no longer accrue on
      hidden/deleted reels (which feed the virality prizes).
    - `deleteOwnComment` now also requires `hiddenAt: null`, so a
      moderator-hidden comment cannot be deleted by its owner and decrement
      `commentCount` a second time.

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
