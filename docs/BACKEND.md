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

**Hours have one implementation.** `rollUpHours()` decides what a phase is worth and both the trail and the reviewer call it. Journal and Hackatime hours are additive; timelapse duration is *not* (it is a recording of hours already claimed). Where a Lapse recording names a Hackatime project, the time Hackatime tracked inside its window is measured by Hackatime itself (`measureOverlap`, cached per window in `hackatime_link.cachedOverlap`) and comes off that link, whatever the entry is. Only a live devlog also claims the sitting's hours: a recording on a tracked or deleted entry takes its Hackatime time out without adding any, because tracked time has to be shown with a devlog. A recording with no project, or another project's name, touches nothing but its own entry.

**Uploads store keys, never URLs**, minted at read time so the bucket can move. Keys are `<folder>/<userId>/<uuid>.<ext>` and are **not secrets** – the feed returns a full video URL for every reel. Anywhere a client hands a key back, check `isOwnedKey()`, or a stranger's timelapse becomes evidence for hours nobody worked.

**Nobody reviews their own work**, and a build cannot be approved before its design.

**The submit gate is server-side.** `submitPhase` re-runs `checkRepo` rather than trusting the submit sheet: a missing README, too little text or too few photos, or a missing required file blocks, while the README BOM table is only a warning. The CAD source list accepts editable files from accepted tools only – Tinkercad, OpenSCAD, Blender and STL-only fail – and a starter project still carrying the starter's own description is refused. See `docs/ARCHITECTURE.md`.

---

## Reviewing on the console

Every decision is made on `/reviews` and goes through `finalizeReview` (`lib/review.ts`). It applies the status, the credit, the tier and the approved hours, writes the review and its audit row, mirrors the decision to the Airtable row for Loops, and notifies the maker. Nothing else decides: an approval, a return, a rejection, a reversal or a dispute reply all come from a reviewer's action on the screen.

- **One decision per hand-in.** `finalizeReview` refuses a hand-in that is already resolved, so a double click, or two reviewers racing, cannot decide it twice.
- **A design approval needs a tier.** The design approval is also the funding decision. The tier is the reviewer's choice, falling back to the maker's request; going above the request needs `MANAGE_CREDIT`.
- **Hours are the reviewer's cut.** The claim comes from `getHoursBreakdown`; a reviewer can cut it per entry, and a cut carries a deflation reason.

---

## The review platform (`/reviews`)

Fabricate's review UI, running on Half Life's review backend. It replaced the `/review` queue and decision screen. `/review/[id]` remains only for answering disputes. Every decision goes through the same `/api/review/*` routes, and `finalizeReview` refuses a hand-in that is already resolved.

- **Its own world.** `app/(review)` is a fourth root layout, drawn in Fabricate's design system: `app/(review)/styles` is a verbatim copy of Fabricate's stylesheets (Biome skips it), `half-life.css` beside it holds the few additions the port needed. Links into it from the rest of the app go through `HardLink`, because crossing root layouts must be a full page load.
- **No new decision logic.** Claims, per-entry deflation, Hackatime hours, decisions, reversals and dispute replies all go through the console's existing routes (`/api/review/*`, `/api/admin/theme-projects/[id]/override`, `/api/admin/disputes/*`), so every rule those routes enforce holds here – nobody reviews their own work, a reviewer cannot raise a tier past the request or set a grant without MANAGE_CREDIT, a live claim locks out everyone else. The one change to them is that approvals now accept `technicalFeatures`, which `finalizeReview` already stored for Ari.
- **Reads** are `lib/review-platform/queries.ts`. What a viewer sees follows the console's lines (`lib/review-platform/viewer.ts`): contact details for ADMIN and AUDITOR, risk flags and internal notes for those and for REVIEW_HOURS holders. An Ari decision stores its reviewer's address as a name, so that is shown as "Ari" to anyone without contact access.
- **Left out of the port**, because Half Life has nothing they could run on: every AI check but the experience check (cart, README, follow-up, image reuse, and Claude's look at a Spork flag), the repo checklist, Slack threads, scraps and the early kit, review telemetry, reviewer pledges, the Unified T2 queue and the YSWS justification composer – Half Life writes that record itself from the decision.
- **Robert and Spork** (`lib/telescreen.ts`), Telescreen's fraud review and copy check, as Fabricate has them. A hand-in sends the project to Robert as a hardware journal (`halflife-project-<id>`, every work session with its pictures and timelapses) and screens its GitHub repo with Spork, one screen at a time; an approval from the review screen sends it to Robert again. Everything is kept on one `TelescreenCheck` row per project. Robert's outcome arrives at `POST /api/integrations/robert/webhook` (signed with `ROBERT_WEBHOOK_SECRET`) and the `telescreen-sync` job (every 10 minutes) pulls trust scores, records our outcome in Robert on its own – approved when the project is approved here with a score of 8 or more, rejected when it is rejected here with nothing approved – and replays sends and screens that were missed or failed over an hour ago. The review screen shows a Robert card when Robert is suspicious (score 7 or less, or rejected for fraud) or an admin has the outcome to record, and a Spork card when Spork found a near-identical KiCad board or STEP model, which reviewers can mark real or false (`/api/reviews/[id]/robert`, `/api/reviews/[id]/spork`). Unlike Fabricate, neither flags the project on its own: Half Life's flags are reviewers' notes.
- **The Files tab** is Fabricate's repository viewer (`components/review/hurt`), copied whole. It is type-checked under Fabricate's own compiler settings (`tsconfig.hurt.json`, run by `bun run typecheck`), excluded from the main tsconfig and the linters, and reached through the `@review/hurt` alias (`turbopack.resolveAlias`). Its GitHub reads go through `forgeGet` – the gh-proxy pool – in `/api/reviews/[id]/files/*`; the browser fetches file bodies from raw.githubusercontent.com itself. WebAssembly and pdf.js data are served from the installed packages by `/api/reviews/assets/*`, an allowlist. STEP/IGES/BREP models too big for the browser are converted on the server, as in Fabricate: `lib/review-platform/model-conversion.ts` has FART (`FART_URL`, hackclub/fart, which runs OpenCascade for Fabricate too) convert them, one at a time, authenticated with `FART_TOKEN`, and keeps the GLB on local disk keyed by repo, commit and path. Nothing heavy runs in this app's pod. FART's README lists the endpoints this depends on. The `@tracespace/plotter` fix Fabricate applies in a postinstall script is a `bun patch` here (`patches/`), which is why the Dockerfile copies that folder before installing.
- **Images.** README pictures live on GitHub, so `/reviews` gets GitHub's image hosts in its CSP (`REVIEW_PLATFORM_HOSTS` in `lib/csp.ts`). Only there: the platform is staff-only, and every participant-facing page keeps the narrower policy.
- **Offline reviews** (`/reviews/offline`, `components/review/offline`), Fabricate's offline reviews on Half Life's screen. "Save for offline" on the queue hands that page's pending rows to `/reviews/offline`, which downloads each into Cache Storage: the screen's data (`/api/reviews/[id]/offline`, `getReviewDetail` plus the time it was read), the Files tab's tree, commits, compare presets and raw files (the viewer's own size caps; big models converted on FART first), the Airtable preview, Lapse's answers and videos, and journal pictures. Half Life's bucket sends no CORS headers, so its pictures come through `/api/reviews/media`, which only reads Hack Club's asset hosts (`isProxiedMediaUrl`). A service worker (`public/review-offline-worker.js`, scope `/reviews/offline` only, so online reviewing never goes through it) keeps the page and the build's files (`/api/reviews/offline-assets`) and answers the page's requests from the downloads. Reviewing offline is `ShipReview` itself on an offline `ReviewRuntime` (`components/review/runtime.tsx`): writes go to an outbox (Cache Storage, mirrored in localStorage) and moves stay on the page. Videos play from `/reviews/offline/media?url=…`, because Firefox never sends a cross-origin `<video>` request through a service worker. Sending checks each review against the submission as it is now (`GET /api/review/submissions/[id]`): decided since, or claimed by someone else, is refused; a journal entry added or changed since the download is shown and sent only on "Send anyway". Then it claims, saves the hours and decides through the usual routes.

## Payouts

**`ProgramSettings.payoutSource` decides which grant path the admin tools use.** Under `HCB`, `/admin/grants` issues HCB card grants (below) and the Airtable row's `Requested funding` column is written as zero. Under `AIRTABLE`, approval still mints coins and freezes `grantUsd`, but nothing in Half Life pays from the YSWS table: it has never been a payout source, and it only feeds Loops.

### HCB card grants

`/admin/grants` issues one HCB card grant per approved design, for the **BOM total** (`bomTotalUsd`, including tax and shipping), not `grantUsd`. It needs `MANAGE_CREDIT`.

- the preview and the batch are the same query; a SHA-256 fingerprint over `projectId:amountCents:email` means a stale confirmation cannot issue a different set;
- `HcbGrantCard` has a partial unique index on `(themeProjectId, phase)` for `PENDING`, `ISSUED` and `AMBIGUOUS`, so two batches or two tabs cannot create two live grants;
- a row is claimed with a compare-and-set before HCB is called, and each request processes a small chunk;
- a lost response is reconciled against `GET /organizations/{slug}/card_grants` by email, amount and the constant purpose. Only a known absence may retry;
- an owner mismatch cancels the grant and leaves it `AMBIGUOUS`; a reconciliation with several matches does the same;
- every issue writes `ADMIN_ISSUE_GRANT_CARD` with the HCB grant id in the same transaction as the `ISSUED` row;
- un-approving a design is refused while a live card grant exists; cancel it first.

The legacy `/admin/users/[id]` "Send grant" top-up (`lib/grants.ts`, `HcbGrantTopUp`) remains as history and is refused whenever the payout source is HCB. Under `AIRTABLE` it stays available, with the same approved-design, identity and owner checks.

### HCB configuration

- **The HCB v3 API is read-only.** Grants go through the authenticated **v4** API. Set `HCB_ORG_SLUG` plus either a static `HCB_ACCESS_TOKEN` or the OAuth application's client credentials, then authorise the application once (next bullet).
- **Authorising the app is what stores the token.** HCB spends a refresh token when it is used and returns a new one, so the token is never typed into an env var: sign in as a Half Life admin and press **Connect HCB** on `/admin/grants`. That admin-only POST mints a `state` and a PKCE verifier into `__Host-` cookies and sends the browser to HCB's authorise page; HCB redirects to `/api/integrations/hcb/callback`, and that route checks the state, the verifier, a signed-in admin and a top-level navigation before exchanging the code and storing the replacement encrypted in `hcb_credential` (keyed from `BETTER_AUTH_SECRET` with its own HKDF info). Every later refresh rewrites the row. Reconnecting from the same page is the recovery path, and asks for confirmation first because it replaces a working credential; `HCB_REFRESH_TOKEN` exists only to seed a headless deployment. Opening the authorise link by hand can no longer complete anything – the state and verifier it lacks are what stop a captured code from being replayed by a journal image or any other page. Concurrent refreshes are serialised to one exchange. A refresh failure includes HCB's `error` body and is logged, so a spent token is distinguishable from a bad client secret.
- **The registered redirect URI is `/api/integrations/hcb/callback`.** That route both reserves the path and completes the exchange, so set `HCB_REDIRECT_URI` to the same absolute URL the application is registered with – on production, `https://halflife.hackclub.com/api/integrations/hcb/callback`.
- **Scopes the client actually uses:** `card_grants:read` and `card_grants:write` (create, top up, cancel, reconcile), `organizations:read` (balance preflight) and `transactions:write` (the memo on a top-up's transaction). Add `restricted` to make HCB enforce them; without it the granular scopes are not checked. Reading another user's email needs `pii` plus `admin:write` on an HCB admin's token, which an ordinary org manager cannot get, so the owner check normally runs with `HCB_VERIFY_GRANT_OWNER=false` or should read the card grant's own `email` field instead.
- **Without API credentials, `/admin/grants` still has a no-API path.** The **HCB CSV import** panel writes the same ready projects into the organisation's bulk-import template (`card_grants_template.csv`: `email, amount_cents, purpose, instructions, one_time_use, pre_authorization_required, invite_message` and the empty lock/banned columns — `src/lib/grant-card-csv.ts`), and the admin uploads it to HCB to create the cards. The file is frozen into `HcbCardGrantExportBatch` + `HcbCardGrantExportRow` (fingerprint + atomic rows, audited as `ADMIN_CREATE_GRANT_CARD_EXPORT`), is re-downloadable from the Generated CSV files history, and a project in it drops out of future previews, so a second file cannot pay it again. The preview-level checks still apply: only `payoutSource === HCB`, and top-up or card-grant-paid projects never appear.
- **Only unified projects are paid.** A project whose design row's `Automation - First Submitted At` is empty was never put in the unified database by the pipeline, so it is excluded from the preview with "Not in the unified database" and the fingerprint does not include it. The check reads the YSWS table live, and it fails closed: when the read cannot run, every ready project is excluded with "Could not check the unified database" rather than paid unverified. A deployment with no Airtable reads at all skips the check, because without the integration no project can be in the base either way.
- **The token has to be able to read the maker's email.** The owner check compares the card's owner with the maker's address. HCB renders another account's email only to a token carrying `pii` **and** `admin:write`, authorised by an HCB admin – an ordinary organisation manager cannot satisfy that, so `HCB_VERIFY_GRANT_OWNER=true` refuses every grant on such a token with "HCB would not say who that grant belongs to". Either keep the check off with `HCB_VERIFY_GRANT_OWNER=false` (the audit row then records that nobody checked whose card it was) or compare against the card grant's own top-level `email`, which HCB returns unconditionally.

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
- **The Docker image ships `scripts/` and `src/`.** The runner stage copies both (`Dockerfile`, runner stage), so a script runs in a pod with `bun --conditions=react-server scripts/<name>.ts` from `/app`.
- **`.env.example` comments live above values, not beside them** – a trailing comment gets copy-pasted into a deployment and a 32-character R2 key becomes 59.
- **Asset URLs stored in journals have two possible key layouts.** Before the S3 client stopped putting the bucket name in the path, an object landed at `<bucket>/<key>` and its URL was `<origin>/<bucket>/<key>`. Both that and the current `<origin>/<key>` are valid, so `bun run uploads:backfill-urls` lists the bucket once before rewriting anything rather than assuming one layout. Objects themselves are the other half: `bun run uploads:migrate-legacy` copies every legacy `<bucket>/<key>` object to `<key>` server-side, which is what makes the keys rows already hold resolve. It leaves the legacy copies unless `--delete-legacy` is passed; run the URL backfill first if those are to go, because a journal may still name the legacy URL, and let mirrored projects sync `JOURNAL.md` once more before deleting.
- **Coins are minted at review approval, not when hours are logged.** The trail moves immediately because the node is the entry, not the payment.

---

## Open, and deliberate

- **R2 is public-read.** Anything uploaded is fetchable by URL, by anyone. Reels, journal photos, timelapses.
- **`/explore` publishes journal bodies to every participant.** Written for a reviewer, read by peers.
- **`/admin/feed` is post-only** – no way to unpin or remove an announcement without the moderation route.
- **Deadlines are soft by design.** A late joiner has to be able to finish, so almost nothing on the trail is hard-locked; the one real gate is that a build cannot be approved before its design.
