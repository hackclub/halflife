# Security and bug audit – 2026-11-18

A fourth pass over the repository at `21c1edeb`, focused on the 518 commits since the 2026-10-26 findings (`SECURITY_FINDINGS_2.md`): the grant-card and HCB buffer top-up code, the new admin powers (force submit, unsubmit, hours correction, set starter), the review platform and its file viewers, Airtable address handling, and the presigned upload flow. It also re-checks every item `SECURITY_FINDINGS_2.md` left open.

**Method:** five parallel read-only passes, covering money and grants, auth and route authorisation (all 139 route handlers), integrations and jobs, uploads and rendering, and programme domain logic. Each finding was traced through the code end to end. The High findings and the upload findings were then re-read by hand. No database writes and no calls to external services were made.

**Tooling at the time of writing:**
- `bun run typecheck`, `bun run lint` and `bun audit` (492 packages) are clean.
- `bun run test` passes: 663 tests across 93 files.

> This document describes unfixed holes in enough detail to exploit them. Keep it out of the public repository until the High and Medium items are fixed.

**Legend:**
- Severity: **HIGH** · **MED** · **LOW**
- Confidence: *confirmed* (traced end to end) · *likely* (depends on something outside the repo) · *speculative*

## Summary

| # | Severity | Finding | Area |
| --- | --- | --- | --- |
| 1 | HIGH | HCB OAuth callback has no `state`; one journal image can swap the deployment's HCB credential | money / CSRF |
| 2 | HIGH | Editing a journal entry silently resets `hoursSource` to MANUAL (zod defaults survive `.partial()`) | hours / money |
| 3 | MED | Admin force-submit still enforces the closed and not-started gates inside the transaction | admin powers |
| 4 | MED | Lost-response HCB match can claim another of the maker's grant cards, leaving a card stuck unpaid | money |
| 5 | MED | A card batch and a CSV export can claim the same project concurrently, paying it twice | money |
| 6 | MED | A cancelled grant card makes the project payable in full again | money |
| 7 | MED | Review file viewers hand repo SVGs a same-origin `blob:` URL (reviewer-session script) | XSS |
| 8 | MED | Presigned PUTs are unbounded in size and type, and unconfirmed objects are never removed | uploads |
| 9 | MED | Posts, covers, session media and attachments accept keys that were never confirmed | uploads |
| 10 | MED | A changed HCA address keeps old lines, so parts can ship to a mixed address | PII / fulfilment |
| 11 | MED | Unauthenticated handoff JSON bodies have no size cap | DoS |
| 12 | MED | A ban with "hide content" leaves journals and the profile public | moderation |
| 13 | MED | Participants joining after week 5 get an onboarding project they can never submit | programme logic |
| 14 | MED | `GET /api/me/shipping-address` calls HCA on every request with no rate limit | integrations |
| 15-34 | LOW | See section 3 | various |

## 1. High

### 1. The HCB OAuth callback has no `state` check, and a journal image can trigger it for an admin – **HIGH** (*confirmed* in code; *likely* overall)

- **Code:** `src/app/api/integrations/hcb/callback/route.ts:66-143`.
  - Any `GET ?code=` from a browser holding `MANAGE_PROGRAM` exchanges the code and calls `storeRefreshToken`, which overwrites the single stored credential (`src/lib/hcb-credential.ts:49-56`).
  - The route has no `state`, no PKCE, no `Sec-Fetch-Dest` check, and it writes on a GET.
- **Why it can be zero-click:**
  - `safeSrc` accepts any absolute `https://` URL (`src/lib/markdown.ts:17-23`). The CSP's `img-src` includes `'self'` (`src/lib/csp.ts`). Journal content is not checked against an image host allowlist on the server.
  - So a journal entry containing `![x](https://halflife.hackclub.com/api/integrations/hcb/callback?code=…)` fires a credentialed same-site GET at the callback from any admin's browser that renders it: on Explore, on a profile, or on the review platform, whose `renderReviewMarkdown` uses the same `safeSrc`.
- **Scenario:**
  1. The attacker authorises the Half Life HCB application with their own HCB account and captures the code at the redirect. A non-admin gets the 403 *before* the exchange, so the code is still unspent.
  2. Within the code's lifetime, the attacker posts it as a journal image.
  3. The next admin who scrolls past it replaces the deployment's HCB credential.
- **Impact:**
  - Every grant issue, top-up, reconcile and balance read then runs as the attacker's identity. In practice payouts stop.
  - HCB rotates refresh tokens, so the legitimate token is gone and an admin must re-authorise.
  - If the attacker is a member of the paying org, actions are attributed to them.
- **Corroboration:** the money, integrations and auth passes found this independently.
- **Unconfirmed:** whether any HCB user can authorise this application, and how long HCB codes last.
- **Fix:**
  - Start the flow from an admin-only "Connect HCB" POST that stores a random `state` in a cookie, and check it on the callback. Add PKCE.
  - Refuse unless `Sec-Fetch-Dest: document`.
  - Refuse to overwrite an existing credential without confirmation.
  - Separately, have `safeSrc` drop absolute URLs whose host is one of `APP_PUBLIC_HOSTS`, so no journal image can target our own routes.
  - Also correct `.env.example:203`, which still says this route "never stores a token".

### 2. Editing a journal entry resets `hoursSource` to MANUAL – **HIGH** (*confirmed*)

- **Code:**
  - `src/lib/schemas/session.ts:90`: `sessionUpdateSchema = sessionCreateSchema.omit({ media: true }).partial().strict()`.
  - In zod 4, `.partial()` keeps `.default("MANUAL")` (line 69) and `.default([])` (line 78). `sessionUpdateSchema.parse({ title: "hi" })` yields `{ hoursSource: "MANUAL", timelapses: [], title: "hi" }`.
  - The PATCH route (`src/app/api/projects/[id]/sessions/[sessionId]/route.ts:109-148`) therefore always sees `data.hoursSource` as defined and writes it.
- **Scenario A (hours double count):**
  - The participant client never sends `hoursSource` (`src/lib/store-writes.ts:399-407`).
  - Every edit of a legacy or imported `HACKATIME_TRACKED` entry flips it to MANUAL. Its `hoursClaimed` then counts as journal hours on top of the Hackatime link that already pays for the same time.
  - That inflates coins and can clear a tier's funding-hours floor.
- **Scenario B (clips deleted):**
  - Any client that PATCHes only `title`/`content` gets `want = []`, and `reconcileSessionTimelapses` removes every Lapse clip on the entry. This contradicts the route's own comment ("`timelapses`, when present…").
  - The participant client always sends `timelapses`, so today this reaches only other API callers.
- **Fix:**
  - Declare the update schema without defaults: `hoursSource: z.enum(HoursSource).optional()` and `timelapses: z.array(…).optional()`.
  - Add a test that `parse({ title })` yields only `title`.
  - Consider refusing a participant edit that moves `hoursSource` away from `HACKATIME_TRACKED`.
  - Then check for entries already flipped: `HACKATIME_TRACKED` rows edited since the schema landed, recorded as `USER_UPDATE_SESSION` audit rows.

## 2. Medium

### 3. Admin force-submit fails in exactly the cases it exists for – **MED** (*confirmed*)

- **Code:**
  - `src/lib/submissions.ts:127-131` skips the timing gates when `options.force` is set.
  - The transaction's re-check at `src/lib/submissions.ts:249-269` ignores `force`, and calls `ignoresSchedule(userId)` and `assertWeekStarted(…, userId)` with the *maker's* id.
  - Caller: `src/app/api/admin/theme-projects/[id]/submit/route.ts:32`.
- **Scenario:** submissions are closed and the maker has no extension. An admin forces the submit. All the pre-transaction work runs, then the transaction throws `SUBMISSIONS_CLOSED`. A week that hasn't opened throws `WEEK_NOT_STARTED`. The error looks like an ordinary refusal.
- **Related (LOW):** the pre-check reads `WeekExtension` for both of the project's weeks (`src/lib/program.ts:325-341`), while the transaction reads only `scheduledWeek` (`submissions.ts:249`). An ordinary submit can therefore pass the pre-check and fail in the transaction.
- **Fix:**
  - Wrap the transaction's `stillOpen`/`assertWeekStarted` checks in `if (!options.force)`.
  - Read extensions through one shared helper.
  - Add a test that force-submits with `submissionsOpen=false`.

### 4. The lost-response HCB match can claim another of the maker's grant cards – **MED** (*confirmed*)

- **Code:**
  - `purposeMatches` (`src/lib/hcb.ts:514-517`) accepts any purpose starting with `"Half Life parts – "`, which every titled card now has (`grantCardPurpose`).
  - It does not exclude grant ids the site already holds.
  - Callers: `src/lib/grant-cards.ts:881`, `:966`, `:1115`.
- **Scenario:**
  1. A maker has two projects at the same tier cap, so both cards are the same amount.
  2. Card A is issued. Card B's create returns a 5xx and did not land.
  3. The reconcile finds A's grant and reports it as B's.
  4. `markIssued` violates the unique index on `hcbCardGrantId`, and the request 500s, abandoning the rest of the chunk.
  5. Row B stays PENDING and fails the same way on every retry. The reconcile route refuses PENDING rows.
- **Impact:** the maker is never paid for B. `reconcileGrantCard` can make the same wrong match for a FAILED row.
- **Fix:**
  - Before matching, exclude every id already stored in `HcbGrantCard.hcbCardGrantId` and `HcbGrantTopUp.grantHashid`, as `reconcileCsvExportRows` already does.
  - Require exact purpose equality when the expected purpose carries a title. Keep the prefix rule only for title-less legacy rows.

### 5. A card batch and a CSV export can claim the same project at once – **MED** (*confirmed* race; needs two near-simultaneous requests)

- **Code:**
  - `createGrantCardBatch` (`src/lib/grant-cards.ts:376-423`) and `createGrantCardExportBatch` (`:465-514`) each re-check only their own table, at READ COMMITTED.
  - The unique indexes are per table: `hcb_grant_card_project_phase_live_key` and `hcb_card_grant_export_row_project_key`.
  - `processCardGrantBatch` (`:834-844`) does not re-check live export rows.
  - `recordStarterCards` (`src/lib/starter-card-records.ts`) has the same cross-table gap.
- **Scenario:** two admins act on the same preview, or one admin presses both buttons. Both transactions commit. The API batch issues a card, and the CSV upload creates a second one.
- **Fix:**
  - Take one advisory lock (e.g. `lockKey(tx, "grant-cards:issue")`) as the first statement of all three writers.
  - Re-check live export rows in `processCardGrantBatch` before `createCardGrant`.

### 6. Cancelling a grant card makes the project payable in full again – **MED** (*confirmed*; design gap)

- **Code:** `cancelGrantCard` (`src/lib/grant-cards.ts:1156-1187`) marks the row CANCELED. `buildPreview` (`:193-198`) counts only PENDING, ISSUED and AMBIGUOUS cards as live.
- **Scenario:** a maker spends $25 of a $30 card. An admin cancels it, for example to fix an email, and HCB returns the unspent $5. The next batch issues a fresh $30 card, so the design has now been funded $55.
- **Fix:** on cancel, record the spent cents (`readCardGrantSpend`) and subtract them from the reissue. Alternatively, keep the project out of the preview until an admin explicitly confirms a reissue.

### 7. Review file viewers give repo SVGs a same-origin `blob:` URL – **MED** (*confirmed* by reading; the browser behaviour is the one `e915d0a6` fixed)

- **Code:**
  - `src/components/review/hurt/viewers/MarkdownViewer.tsx:48-55` takes the `!source.rawUrl` branch, typed through `IMAGE_MIME`, which includes `svg`.
  - `src/components/review/hurt/viewers/office/DocumentViewer.tsx:11-19` does the same.
  - `ImageViewer.tsx:50-87` already rasterises SVGs for exactly this reason. These two paths skip it.
- **Why it matters:** the CSP has no `script-src` (see #29), so an SVG's script runs with the app's origin.
- **Scenario:**
  1. A maker commits a zip containing `README.md` (`![schematic](s.svg)`) and an `s.svg` with an `onload` handler. Archive sources have no `rawUrl`, so the picture becomes a `blob:` URL of type `image/svg+xml`.
  2. The reviewer chooses "Open image in new tab".
  3. The script runs on the app's origin with the reviewer's session, and can call the review APIs: approve hours, or set tiers and grants with an admin reviewer.
  - A `.docx` or `.pptx` with an SVG media part does the same without the zip.
- **Fix:**
  - Route both paths through `rasterizeSvg`, or drop `svg` from the MIME map these helpers use.
  - As hardening, build generated SVG previews as `data:` URLs rather than `blob:`: `EagleViewer.tsx:65`, `GerberBoard.tsx:54`, `IbomViewer.tsx:341`, `FritzingViewer.tsx:107`. Browsers refuse top-level navigation to `data:`.

### 8. Presigned PUTs are unbounded, and unconfirmed objects live forever on the public asset host – **MED** (*confirmed* on Bun 1.4.4; R2's serving behaviour is from the repo's own comment at `r2.ts:296`)

- **Code:** `src/lib/uploads/r2.ts:298-307`, `src/app/api/upload/presign/route.ts:60-71`, `src/lib/handoff.ts:147-158`.
- **What's wrong:**
  - The URL signs only `host`. Content-Type and Content-Length are not enforced; `response-content-type` only affects GETs.
  - `/confirm` is the only check, and calling it is up to the client.
  - Nothing sweeps objects that were never confirmed: `deleteObject` is called only from verify, feed delete and handoff.
- **Scenario:** a participant presigns `sessions/…/x.mp4`, PUTs `<html><script>…` with `Content-Type: text/html`, and never confirms.
  - The asset host now serves attacker HTML indefinitely, under Hack Club branding.
  - If that host is a `*.hackclub.com` subdomain, the script can read non-HttpOnly `.hackclub.com` cookies. App writes stay safe, because `guards.ts:86-95` refuses same-site requests.
  - The same PUT path stores up to 5 GiB per object, at 30 presigns a minute.
  - The unauthenticated handoff presign lets anyone holding a photo of the QR code write into the victim's `posts/` prefix for 10 minutes.
- **Fix:**
  - Upload to a `pending/` prefix the public domain does not serve, and copy to the real key on confirm. Add an R2 lifecycle rule that expires `pending/` after a day.
  - Bound size and type with a presigned POST policy (`content-length-range`, exact `Content-Type`).
  - Have the asset domain send `X-Content-Type-Options: nosniff`, and `Content-Disposition: attachment` for anything that isn't image or video.

### 9. Posts, covers, session media and submission attachments accept keys that were never confirmed – **MED** (*confirmed*)

- **Code:**
  - `assertOwnedKey` (`src/lib/feed.ts:236-240`, used at `:280`) checks only shape and owner.
  - The same is true at `src/app/api/projects/[id]/route.ts:194-197`, `src/app/api/projects/[id]/sessions/route.ts:146` and `src/lib/submissions.ts:171`.
- **Scenario:** `POST /api/posts { objectKey: "posts/<me>/anything.mp4", checkpointKey: "w3-reel-idea" }` creates a published reel with no video behind it.
  - It ticks a required reel checkpoint and adds a streak day.
  - Combined with #8, it can instead point at a 5 GB or non-video object, which every feed viewer, mostly on phones, is then served.
  - Session media `type`/`contentType` are client claims as well.
- **Fix:**
  - Have `/confirm` record the upload (key, owner, kind, size, type).
  - Require that record in `createPost`, the cover PATCH, session media and submission attachments.
  - Take `byteSize`/`contentType` from the record, not from the request.

### 10. A changed HCA address keeps old lines – **MED** (*confirmed*; affects shipping to minors)

- **Code:** `encryptedFieldsFrom` (`src/lib/hca-profile.ts:210-221`) emits only the fields that are present. They are spread into the update at `:320`.
- **Scenario:**
  - A maker's old address had `line_2 = "Apt 4B"` and a state, and their new one has neither. The update writes the new street, city and zip but leaves the old line 2 and state.
  - `readAddressSnapshot` (`src/lib/airtable/address.ts:30-37`) hands the mixed address to the Airtable submission row (`src/lib/airtable/sync.ts:233-234`, `:478-482`), so parts can ship to a label combining two addresses.
  - If the maker removes their address from HCA, the stored copy survives, and the address reminder never fires.
- **Fix:**
  - When HCA returns an address, write all six columns, nulling the missing ones.
  - Decide explicitly what "HCA has no address" means: clear the copy, or flag it.
  - Then re-sync addresses for makers whose HCA address changed since address capture landed.

### 11. Unauthenticated handoff JSON bodies have no size cap – **MED** (*likely*; depends on the ingress body limit)

- **Code:**
  - `parseBody` (`src/lib/api.ts:36-39`) calls `request.json()` with no limit.
  - `src/proxy.ts:106` excludes `api/handoff`, `api/upload` and `api/integrations`, so Next's proxy body limit does not apply.
  - Affected: `POST /api/handoff/presign` and `/api/handoff/confirm` (no session), plus the signed-in `/api/upload/presign`, `/confirm` and `/from-url`.
- **Scenario:** one POST of several hundred MB, with no session, is buffered and parsed in full. The per-IP limit of 5 a minute does not stop a single request.
- **Fix:** give `parseBody` a byte cap (e.g. 64 KB) using the existing `readBodyWithCap`, as the Slack, Ari and Ire webhooks already do.

### 12. A ban with "hide content" leaves the user's journals and profile public – **MED** (*confirmed*)

- **Code:**
  - `hideAllContent` (`src/lib/moderation.ts:244-264`) hides only `Post` and `PostComment`.
  - `getJournalFeed` (`src/lib/queries/community.ts:44-60`) and `src/lib/queries/profile.ts` have no `bannedAt` filter.
  - `WorkSession` has no `hiddenAt` column.
- **Scenario:** a user is banned for abusive writing with `hideContent: true`. Their reels disappear, but their free-text journal entries stay on Explore and on their profile.
- **Fix:** filter `themeProject.user.bannedAt IS NULL` (or a hide-content flag) in the Explore and profile queries, or add `hiddenByBanAt` to `WorkSession` and include it in `hideAllContent`/`restoreAllContent`.

### 13. Participants joining after week 5 get an onboarding project they can never submit – **MED** (*confirmed* by code path; impact depends on whether sign-ups are still open)

- **Code:** `themeForCurrentWeek` (`src/lib/onboarding.ts:109-113`) wraps week N to design week ((N-1)%5)+1.
- **Scenario:** someone signs up in week 7 and is given the week-2 theme, whose design week closed on 18 October.
  - Design entries are refused with `WEEK_CLOSED`, and a Hackatime link adds 0 h because it is scoped to week 2.
  - The design hand-in then fails, and the build can't be submitted while the design is `draft` (`submissions.ts:76`).
  - Any build hours logged in the meantime are stranded.
- **Fix:** auto-grant a `WeekExtension` when onboarding provisions a passed design week, or route late joiners to warm-up or freestyle. At minimum, list affected users for staff.

### 14. `GET /api/me/shipping-address` calls HCA on every request – **MED** (*likely*)

- **Code:** `src/app/api/me/shipping-address/route.ts:12-14` → `addressReminderNeeded` → `readAddressSnapshot` → `syncHcaProfile` (`src/lib/shipping-address.ts:21-32`).
- **What happens:** each call makes two HCA requests with retries, possibly refreshes a token, and re-encrypts and writes the user's PII. `AddressReminder` calls it on every shell mount.
- **Scenario:** a maker with an approved design loops the endpoint. HCA already answers this server with 429 and a 300-second retry-after (`hca-profile.ts:59`). Throttling the server's IP breaks sign-in and identity re-checks for everyone. It is also a GET that writes.
- **Fix:** rate-limit per user, and serve the stored copy, syncing with HCA at most once per N minutes per user.

## 3. Low

### Money and admin powers

15. **Admin hours correction skips the maker routes' rules.** `src/app/api/admin/sessions/[id]/route.ts`:
    - It skips the 24 h/day self-reported cap.
    - It doesn't refuse an admin editing their own entries. The same applies to `admin/theme-projects/[id]/grant` and `admin/credits`, against `review.ts:170` ("Admins are not exempt").
    - It writes its audit row with `logAudit` outside the transaction, so a failure is silent.
    - It runs `recomputeWeek` but not `recomputeActiveDays` (`:94-97`).
    - Force submit and admin unsubmit also allow acting on one's own project, and also audit after the commit.
16. **Setting a starter on an approved design can raise the card above what the reviewer approved.** `grantCardCapUsd` returns the $33 starter cap and ignores `grantUsd` (`src/app/api/admin/theme-projects/[id]/route.ts:70`). Refuse once `grantEmittedAt` is set, or use `min(grantUsd, starterCap)`.
17. **`unapprovePhase` doesn't check CSV exports or top-ups.** It refuses when a card is issued, but not when there is a live CSV export row or a sent top-up (`src/lib/review.ts:575-606`). The maker keeps money for a design that is no longer approved. The export row does prevent a second payment.
18. **An old CSV export can be re-downloaded with superseded rows.** `grantCardExportCsv` (`src/lib/grant-cards.ts:553-573`) doesn't filter `supersededAt`. Re-uploading an old file pays a re-paid row twice. Exclude or mark superseded rows, and warn on re-download.
19. **A failed export resets `Funding given` to 0.** `src/lib/grant-cards.ts:464` writes Airtable before the transaction, and the `.catch` at `:511-514` resets it to 0. A racing export can therefore zero values another export just paid. The lock in #5 fixes this; also restore the previous value rather than 0.
20. **Buffer top-up matching can over-confirm.**
    - `src/lib/grant-cards.ts:1290-1294`: since `fe19ddc5`, one grant is offered twice, at full and net amounts, and can confirm two CSV rows. Let each grant id confirm at most one row.
    - `src/lib/hcb-buffer-topups.ts:20-48`: a buffer top-up equal to any site payment is dropped; a landed-but-unsent site payment is recorded as a buffer top-up; two identical top-ups with a null `createdAt` collapse. Match one-to-one by transaction id where possible. This affects reconciliation only.

### Ari

21. **A deferred Ari approval can land on a later resubmission.** `src/lib/ari.ts:313-329` falls back to the newest open row and refuses only when its `ariSubmissionId` *differs*, so a null id passes. Deferred events are replayed by `ari-retry` with no expiry, and withdraw never voids them (`src/lib/withdraw-effects.ts`). The new admin unsubmit makes this easier to reach. Void deferred deliveries on withdraw, and refuse when `byShip` is null and the open row is newer than the event.
22. **Deferred-decision replay can be starved.** `ari-retry` (`route.ts:124-145`) takes the 25 oldest unapplied events and `continue`s on `DESIGN_NOT_APPROVED`, so 25 permanently-blocked events stall the pass. Order by a `lastTriedAt`, or expire them after N days.

### Programme logic

23. **A rejected design's BOM stays editable.** `bomLockReason` (`src/lib/bom.ts:55-60`) doesn't lock on a decided phase. Use `isPhaseDecided`.
24. **A build can be submitted after its design was rejected.** It can never be approved (`submissions.ts:76` vs `review.ts:196/274`). Refuse it at submit.
25. **Session POST and BOM add re-checks are unlocked reads.**
    - Session POST (`sessions/route.ts:184-207`) and BOM add/import (`bom/route.ts:55-74`, `bom/import/route.ts:109-135`) are not under the lock a decision takes, so one row can land in a just-decided phase.
    - Two parallel BOM adds can exceed `MAX_BOM_ITEMS` by one.
    - Fix: lock, or make the insert conditional, as PATCH/DELETE already do.
26. **Smaller programme-logic gaps.**
    - A warm-up's `closesAt` ignores week-0 extensions (`src/lib/queries/store.ts:474-478`; unreachable today).
    - `scripts/backfill-return-extensions.ts` is described as re-run safe, but grants another week once the previous one has lapsed.
    - Admin analytics load the whole `work_session` table per call (`src/lib/queries/admin.ts:1380-1395, 1550-1670, 1953`).

### Auth, PII and privacy

27. **The forge-token encryption only applies to new writes.**
    - `encryptOAuthTokens: true` (`src/lib/auth.ts:125`) encrypts rows when they are next written.
    - GitHub tokens never refresh, so rows linked before the change keep plaintext `repo`-scoped tokens indefinitely.
    - Add a one-off backfill that re-encrypts them.
28. **The CF-Connecting-IP trust is all-or-nothing per process.** `TRUST_CF_CONNECTING_IP` (`src/lib/client-ip.ts:10-16`) applies to every host. If production enables it while pods still answer on `half-life.k.hackclub.dev`, the per-IP rate-limit bypass returns. Block the direct ingress, or trust the header only from Cloudflare's ranges.
29. **The CSP still has no `script-src`.** `src/lib/csp.ts:1-4`. This is what turns #7 into script execution. Track the nonce-based policy.
30. **The partner export leaks emails through `name`.**
    - `src/app/api/integrations/export/participants/route.ts:72` returns raw `name`.
    - `auth.ts:354` stores the email as the name when HCA sends none.
    - So `EXPORT_API_KEY` holders get emails (and minors' full names) despite the scope comment.
    - Use `displayName(u)`, and stop storing the email as the name.
31. **Slack ids reach other users.**
    - Every reel author's and commenter's Slack id reaches all viewers through the Cachet avatar URL (`src/lib/avatar.ts:49`, via `feed.ts:63, 427, 458` and `queries/profile.ts`). This contradicts `feed.ts:133` and the 2026-10-20 note.
    - The review platform returns the maker's Slack id to every reviewer (`src/lib/review-platform/queries.ts:578`, used by the telescreen redirect), where the console strips it.
    - Fix: proxy avatars through `/api/avatar/<userId>`, and decide one reviewer policy.
32. **Smaller auth gaps.**
    - `POST /api/posts/[id]/view`, `/api/reviews/[id]/files/convert` and `/api/onboarding/reset` skip the suspension check. Use `withWrite*`.
    - `/api/me` returns the caller's own `fraudFlagged` (`src/app/api/me/route.ts:16-25`), tipping off flagged users.

### Uploads, rendering and client

33. **Upload and rendering gaps.**
    - The review-platform Markdown guard (`src/lib/review-platform/markdown.ts:13-32`) applies `safeSrc` only to `<img src>`. `<video>`, `<source>`, `poster` and `srcset` pass DOMPurify's HTML profile unchecked, so they can fire credentialed same-origin GETs, which matters for #1.
    - zstd ZIP entries decompress with no cap (`hurt/core/archive.ts:236`). The bomb only crashes the reviewer's tab.
    - `/api/upload/from-url` reserves 100 MiB of the 128 MiB shared pool for up to 10 s per request (`src/app/api/upload/from-url/route.ts:33`).
    - The `img-src` allowlist admits every `*.hackclub.com` and `*.dunkirk.sh` host plus two legacy third-party hosts.
34. **CI, scripts and the client.**
    - The lint workflows still run `bun install` with a `contents: write` token persisted in `.git/config` on pushes to `main`, which reaches the auto-deploying `prod` through a release PR (`.github/workflows/oxlint.yml:14-42`, `biome.yml:14-15`). Split them into a read-only lint job and a no-install push job, or set `persist-credentials: false`.
    - `scripts/backfill-airtable-addresses.ts:394-398` writes its report to a hard-coded `/tmp/opencode` with default permissions.
    - A journal entry saved before its project row exists reports success and discards the draft (`src/lib/store-writes.ts:324-375`). Return an error when `routeOf(id)` is null.
    - `/signed-out` still logs a user out on a cross-site top-level navigation; it only checks `Sec-Fetch-Dest`. Low impact.

## 4. Status of the 2026-10-26 findings (`SECURITY_FINDINGS_2.md`)

| Item | Status | Evidence |
| --- | --- | --- |
| 1. Sign-in with a caller-supplied `idToken` (account takeover) | Fixed | `hooks.before` rejects `idToken` on `/sign-in/social` and `/link-social`, and only HCA may sign in (`src/lib/auth.ts:274-294`) |
| 2. Borrowing identity verification by linking a second HCA account | Fixed | HCA only as the first account, no unlink, no "verified" write while two HCA accounts exist (`auth.ts:161-198`, `hca-profile.ts:281-314`) |
| 3. Hackatime hours counted on every linked project | Fixed | cross-project check under a `hackatime-link:` lock; hours scoped to the phase's week |
| 4. zod advisory and request body caps | Fixed (dependency); partial (caps) | one `zod@4.6.7` in `bun.lock`, forced by an override; auth body capped at 1 MB. Other routes: #11 |
| 5. README regex ReDoS | Fixed | bounded quantifiers, 64 KB README cap |
| Reviewer hour override and tier escalation | Fixed | override capped to logged hours; tier raise and grant override need `MANAGE_CREDIT` |
| `/signed-out` logout CSRF via a Markdown image | Fixed | `safeSrc` refuses relative paths, and `/signed-out` requires `Sec-Fetch-Dest: document` |
| Tracking pixels; `update-user` image/name | Fixed | `img-src`/`media-src` allowlists; `/update-user` disabled. Breadth of the allowlist: #33 |
| Reviewer ids in `GET /api/projects/[id]` | Fixed | reviewer columns stripped (`projects/[id]/route.ts:103-148`) |
| Private repos readable through server tokens | Fixed | public visibility checked on GitHub and GitLab before any read |
| CF-Connecting-IP trusted on the direct host | Partial | #28 |
| Forge tokens in plaintext; `/get-access-token` reachable | Partial | endpoint disabled, new writes encrypted; existing rows: #27 |
| Webhook bodies read before signature check | Fixed | 1 MB cap before verification on Slack, Ari and Ire |
| Self-reported hours uncapped | Fixed | 24 h/day cap under lock (except the admin route, #15) |
| Name falling back to email | Partial | display is guarded; the stored value and the export are not (#30) |
| Referrals page emails to reviewers | Fixed | ADMIN/AUDITOR only |
| Stale Ari decision on an unseen resubmission | Open (narrowed) | #21 |
| Lint workflows hold a write token | Partial | actions pinned to SHAs and forks read-only; the token is still exposed to `bun install` (#34) |
| CSP has no `script-src` | Open | #29 |
| Deleted or hidden reels stay in storage | Open (by design) | kept so moderation can restore them |

## 5. Checked and found clean

- **Authorisation:**
  - All 139 route handlers have a guard whose permission matches the operation.
  - Participant `[id]` routes are owner-scoped, including the BOM item-to-project binding.
  - Bans are enforced on every route and page guard, and the session cookie cache is off.
  - Writes refuse cross-site requests via `Sec-Fetch-Site`.
  - There are no server actions.
- **PII to lower-trust roles:** user and project directories, user detail, referrals and console submission detail hide email, Slack id and fraud flags from REVIEWER and FULFILLER. PII is encrypted with AES-256-GCM, a random IV per write and an HKDF-derived key. The HCB refresh token is encrypted under its own HKDF label.
- **Webhooks and integrations:**
  - Slack, Ari and Ire signatures are checked on a capped raw body with timing-safe compares and replay ids.
  - Slack resolve buttons check channel membership or authorship.
  - Integration routes use constant-time bearer checks, fail closed when the key is unset, honour `dryRun`, and are batch-bounded.
  - Airtable formulas are escaped.
- **SSRF:** on Bun 1.4.4 the upload-from-URL `lookup` guard is honoured by both `http` and `https`. Redirects are re-checked, ports and userinfo refused, and the bytes sniffed (SVG refused).
- **Money core:**
  - `reconcileGrant` converges and stops at zero.
  - Every approval, unapproval, purchase, refund and fulfilment takes `lockUserCredit` and re-reads under it.
  - Shop purchases are idempotent, with conditional stock updates and per-pot refunds.
  - Card batches claim by compare-and-set and reconcile abandoned claims, the amount is re-derived from the BOM, and cents are rounded.
- **Rendering:**
  - The participant Markdown renderer builds React elements, and `sanitizeHtml` uses an explicit allowlist.
  - The ibom preview is a script-less sandboxed iframe.
  - Eagle, LibrePCB and Gerber SVG output is escaped, and pdf.js is 6.4.
- **Programme maths:** week and DST boundaries (including the 1 November fall-back), the journal window, streaks from `createdAt`, the project provisioning unique index, and the warm-up cap under lock.
- **Deployment:**
  - `.dockerignore` covers `.env*`, `import` and `data`, and the runtime runs as non-root.
  - CI and e2e workflows are read-only, with no `pull_request_target`.

## 6. Suggested order

1. **Now:** #1 (add `state` to the HCB callback, and stop journal images targeting our own hosts) and #2 (drop the schema defaults, then audit already-flipped entries). Both are small.
2. **Next, the money paths:** #4, #5 and #6, plus the grant-card items in #17-#20. Then #3, so the force-submit feature works.
3. **Then uploads:** #8 and #9 together (a confirmed-upload record plus a pending prefix). Then #7 and #11.
4. **Then participant safety:** #10 (and a re-sync of affected addresses), #12, #13 and #14.
5. **The Low items** as cleanups, starting with #27 (a re-encrypt backfill) and #34 (the lint workflow token).
