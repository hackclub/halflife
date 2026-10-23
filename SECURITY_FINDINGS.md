# Security & Bug Audit — halflife

## Audit of 2026-10-20 (branch `fix/security-bug-audit`)

A second, wider pass over the whole tree: every route handler, the money
paths, the data layer, the deployment, and the client-facing reads. Method:
read every file in scope, then verify the high-severity candidates against a
scratch Postgres (all migrations applied, `migrate diff` clean, the
DB-backed verifiers run) and against Bun, the production runtime.

Everything below is fixed. The commits are in order, and each one is
self-contained.

### High

- **The tier's funding-hours floor was a client-only rule.** `submitFloorFor`
  is what the submit sheet promises – a tier's funded block is the least a
  week can be handed in on – but nothing on the server checked it. A
  participant could request Tier 3 (twenty funded hours, a hundred dollars of
  parts), hand a design in on an hour of work, and have it approved at that
  tier by the automatic reviewer, which takes the tier from the request.
  The floor is now checked when a design is handed in, and a decision cannot
  pay a grant on fewer approved hours than the tier funds. The automatic
  reviewer steps the tier down to the one the approved hours earned rather
  than refusing the decision, so it never lands as an error it would keep
  redelivering. (`dbd576c6`)
- **A decided phase was not frozen.** Only a phase *in review* refused an
  edit, so an approved design – one already paid for – could have its title,
  description, repo link, cover and artifact links rewritten under the
  reviewer who had judged them. The parts list and the tier were already
  final at that point, so the project's own details now are too. (`5e3ea9b0`)
- **The database guard against duplicate content reports had been dropped.**
  Five partial unique indexes enforcing one open report per reporter per
  target were created by `20261007120000_report_open_uniqueness` and dropped
  by an unrelated migration a fortnight later, and the schema never said so,
  so `migrate dev` never brought them back. The route's `P2002` catch had
  been dead code: two presses in flight filed the same complaint twice. The
  indexes are back, declared in the schema this time. (`139d7877`)
- **The public origin fell back to the caller's `Host` header.** Three
  modules resolved the site's own address three different ways, and one of
  them used the request's host – which is the `Host` header. A redirect built
  from it answers `307 Location: https://<whatever the caller asked for>/`,
  on `/`, on `/signed-out` and on the auth callback. There is now one
  resolver, and it never uses an arbitrary host. (`2dd3ad7b`)

### Medium

- **A grant was keyed on the project, not on the card.** The hashid that
  identifies the card on HCB's side was unconstrained, so two projects – or
  two makers – could point at the same card and each pay it, and nothing
  checked whose card it was. The hashid is unique now, the card is checked
  against the maker before the money moves, and the trail records whose card
  it was. (`2a3c69ce`)
- **Un-approving a design could leave a balance negative.** The reversal
  reconciled the grant to zero by writing a delta against the grant's own
  rows, which say nothing about what the maker has since spent, so a maker
  who had spent 30 of a 100-coin grant was left at −30 – a state the shop
  and every display refuse to create. The reversal now takes what the maker
  still has, stops at zero, and says in the row's note and the audit row how
  much could not be taken back. (`2a3c69ce`)
- **The decision froze a total it had read before taking the lock.** A batch
  approving hours in between could change the rows after the number was read.
  The hours are read under the lock now; the live Hackatime fetch stays
  outside the transaction, because it is network I/O with a ten second
  timeout and two retries. (`2a3c69ce`)
- **The staff console leaked contact details to the lower-trust roles.** The
  project directory returned every participant's email and Slack id to
  REVIEWER and FULFILLER, the user detail route returned the printer
  award's encrypted address and phone plus the parcel tracking number to
  anybody holding `VIEW_USERS`, and the directory's search box matched email
  and Slack id whatever the caller's role – so it answered "is this person
  registered here" for any address. The same `includePii` rule the user
  directory already used now applies to all three. (`e2a8cffe`)
- **A purchase could leave the SPENDABLE balance negative.** Affordability
  was measured against the combined balance and the debit was written
  against SPENDABLE, so coins sitting in the legacy BANKED pot drove it
  negative. The debit now follows the coins, pot by pot. (`e2a8cffe`)
- **Cursor pagination dropped and repeated rows.** A cursor was a bare row
  id over a compound order, and a cuid says nothing about the timestamp it
  sits next to, so a page boundary between two rows written in the same
  millisecond dropped one and repeated another – and a cursor pointing at a
  deleted row returned an empty page. The cursor is the position in the
  order now. The feed, the comments feed, the review queue, the participant
  export, the session list, the order list, the staff console's lists and
  the ledger all page on that. (`139d7877`, `2dd3ad7b`)
- **The unauthenticated handoff upload route could exhaust memory.** Its
  body size was the caller's choice and was held in memory three or four
  times over while it was parsed. It has its own budget now, and the process
  has a byte budget of its own, taken before the body is read and waited on
  rather than refused. (`b69a9188`)
- **Warm-up projects were uncounted,** and each approved warm-up design
  carries a parts grant, so an uncapped number of them was an uncapped number
  of grants. Three per maker, counted and created under a lock. The number is
  a product decision; it is a constant in `lib/config/program.ts`. (`2a3c69ce`)
- **The program's timezone was typed as free text.** Every week boundary ran
  it through `Intl`, so one admin typo took down every trail snapshot, every
  session write and the streak recompute at once. It is checked as an IANA
  zone where it is typed. (`5e3ea9b0`)
- **Two queries ran concurrently on one transaction client,** which is one
  connection, so they interleaved on it. The active-days rebuild also
  deleted and re-inserted without a lock, so two concurrent rebuilds
  collided on the primary key. (`139d7877`)

### Low

- A grant's audit row was written after the money moved, with the variant
  that swallows failures (`2a3c69ce`); Ari's approved hours were unbounded
  where the console's are capped (`2a3c69ce`); a buyer's note was accepted
  and thrown away (`2a3c69ce`); a Slack delivery was only guarded by Slack's
  own retry header, so a captured signed request replayed inside the
  five-minute window invited members twice and posted tickets twice
  (`b69a9188`); the rate limiters dropped the bucket a throttled caller
  owned when their map filled up (`b69a9188`); redacting an email from a log
  line took eight seconds on a two hundred thousand character string
  (`b69a9188`); two background jobs sorted their whole table
  (`139d7877`); the analytics export opened a transaction per participant
  (`139d7877`); two GET routes wrote to the database, which a cross-site
  navigation could reach (`3e4bb9bf`); a repeated query parameter reached
  Prisma as an array and 500ed (`3e4bb9bf`); the build context did not
  exclude the credential files the repository does (`2dd3ad7b`); the shipped
  template set the public URL to localhost (`2dd3ad7b`); the trusted host
  list was a wildcard over a domain many unrelated projects share
  (`2dd3ad7b`); the loopback test matched any host starting with `127.`
  (`2dd3ad7b`).

### Notes for the maintainer

- `MAX_WARMUP_PROJECTS` (3) and the hour ceiling (168) are product numbers.
  Both are constants in `lib/config/program.ts`.
- The HCB card-owner check needs a token that may read the maker's email
  (`pii`, or an admin in their org). A token that cannot will refuse every
  grant; `HCB_VERIFY_GRANT_OWNER=false` is the documented escape hatch, and
  the audit row records that nobody checked.
- The public origin is now one resolver, and the list of hosts the deployment
  answers on is configuration (`APP_PUBLIC_HOSTS`).
- The feed, the comments feed, the profile page and the community list
  selected every post author's Slack id, and a selected column rides along in
  the RSC payload to every browser that opens the page - so every participant's
  Slack id was handed to every reader. Nothing rendered it. The columns are
  gone. (The repo's own `verify:pii` script asserts this; it was failing on
  `main` and now passes for other people's ids. The one remaining check is the
  VIEWER'S OWN Slack id, inside their own avatar URL - the avatar service is
  keyed by it, so there is no URL that does not contain it.)

---

## Audit of 2026-10-06

Date: 2026-10-06
Scope: `src/`, `prisma/`, `scripts/`, `next.config.ts`, `Dockerfile`, `docker-entrypoint.sh`, `slack-app-manifest.yml`, `.env.example`
Method: manual code scan + targeted verification of high-severity candidates. No dynamic testing.

> **Fix status (2026-10-07):** all actionable items fixed across 4 commits
> (`a525e22` H1/H2, `24c8d4e` M4/L4, `5490fc2` M2/M5, `3638694` M1/M3/M6,
> `a893880` L1–L5/L7/L10/L11). L6 already had try/catch; L9 already best-effort
> (plus `USER_PLACE_ORDER` audit on purchase); L8 (shared rate limiting) and
> L12 (upload guards verified: `requireSession` on both upload routes, bearer
> token on handoff) need no code change. L3 resolved by disabling the cookie
> cache per review answers.

Overall: authz hygiene, SSRF guards, ledger locking, and PII containment are strong. Issues below are ordered by severity. No SQLi / command injection / open CORS found.

---

## High

### H1 — Unbounded `creditAdjustSchema.amount` allows single-call mint / drain
- `src/lib/schemas/admin.ts:36-52` — `z.number().int().refine(n !== 0)`, no `.min/.max`.
- Sink: `src/app/api/admin/credits/route.ts:22-44` — any `MANAGE_CREDIT` holder (or hijacked session) can mint `Number.MAX_SAFE_INTEGER` or claw back to zero-floor in one call. Audit log at `:53-66` is after commit, so no dual control.
- Fix: `.min(-10_000).max(10_000)` (or tier by role), require second approver above threshold.

### H2 — Reviewer `hoursOverride` / `grantUsdOverride` caps are effectively mint caps
- `src/lib/schemas/review.ts:26-27` — `hoursOverride max(2000)`, `grantUsdOverride max(100_000)` (~$100k), fed into `reconcileGrant` / HCB `sendGrant`.
- A fat-finger or compromised `REVIEWER` session mints arbitrary credit/grant in one decision.
- Fix: clamp overrides to tier caps in `finalizeReview`, lower maxes (e.g. hours ≤ 168, grant ≤ 500), require second approver above threshold.

## Medium

### M1 — `VIEW_USERS` is over-broad; fulfiller/reviewer can dump PII + ledger
- Roles: `src/lib/permissions.ts:43-48` — `REVIEWER`, `FULFILLER`, `AUDITOR` all get `VIEW_USERS`.
- Sinks: `src/app/api/admin/users/route.ts:13-20` (email, slackId, verificationStatus, fraudFlagged for all), `src/app/api/admin/users/[id]/route.ts:13-21` → `src/lib/queries/admin.ts:138-197` (`getUserDetail`: email, slackIds, full ledger[50], balances, orders, printer qualification).
- A low-trust `FULFILLER` (shipping role) can enumerate users for phishing / social engineering.
- Fix: split `VIEW_USERS` (directory) vs `VIEW_USER_PII` / `VIEW_CREDIT`, or strip ledger/balances/`fraudFlagged` from `getUserDetail` for non-`ADMIN`/`AUDITOR`.

### M2 — Shop `shopOpen` + printer-qualification checked outside transaction (TOCTOU)
- `src/lib/shop.ts:219-230` checks `getShopAccess` / `requiresPrinterQualified` before `$transaction`; inside (`:232-336`) re-checks stock/balance/region price but not `shopOpen` or qualification.
- Racing shop-close or qualification-revoke still completes purchase.
- Fix: re-read both inside tx on the `tx` client.

### M3 — Direct image uploads trust client MIME, no magic-byte sniff
- `src/lib/uploads/r2.ts:234-249` `validateUpload` checks ext+MIME agreement + size cap only. `isVideoBytes` magic check applies only to `folder==="posts"` video path.
- Contrast: `src/lib/uploads/remote.ts:137-155` (`from-url` path) does `sniffImage` and refuses SVG.
- Attacker can store HTML-as-`.png` with `image/png` ContentType. Served with `nosniff` this is mostly inert, but inconsistent + polyglot risk.
- Sinks: `src/app/api/upload/route.ts:57-62`.
- Fix: `sniffImage(bytes)` on image uploads too; store sniffed contentType, not `file.type`.

### M4 — `sanitizeHtml` uses DOMPurify defaults (allows svg/math/style)
- `src/lib/sanitize.ts:14-16` — bare `DOMPurify.sanitize(input)`.
- Applied to stored fields (`src/app/api/projects/[id]/sessions/route.ts:154`, `src/app/api/projects/[id]/sessions/[sessionId]/route.ts:105`, `src/lib/onboarding.ts:241`). Safe today because render path `src/components/platform/Markdown.tsx:230-353` builds React elements, not `dangerouslySetInnerHTML` — but any future raw-HTML render of journal content becomes stored-XSS.
- Fix: explicit `ALLOWED_TAGS/ATTR`, e.g. no `svg`/`math`, `FORBID_ATTR: [style, on*]`, `ALLOW_DATA_ATTR: false`.

### M5 — Stale `grantUsd` amount captured before HCB call, retry pays stale value
- `src/lib/grants.ts:115,187,196-205` — `amountCents = Math.round(project.grantUsd*100)` captured before HCB; reclaim path re-checks `designStatus/grantUsd` but not amount equality.
- If `grantUsd` edited between claim and retry, retry pays stale amount.
- Fix: re-read `grantUsd` before `topUpCardGrant`, abort on drift.

### M6 — Review queue/detail leaks contact + risk flags to volume reviewer role
- `src/lib/queries/review.ts:58` (queue email), `:101-109` (detail email/slackId/verificationStatus/fraudFlagged), served by `src/app/api/review/queue/route.ts:11`, `src/app/api/review/submissions/[id]/route.ts:11` (both `REVIEW_SUBMISSIONS`, held by all reviewers).
- Enables scraping maker emails; `fraudFlagged` disclosure tips off fraudulent makers.
- Fix: `displayName` only in queue; gate `fraudFlagged`/`verificationStatus` behind `REVIEW_HOURS` or admin.

## Low

### L1 — Project extension checked under wrong permission (privilege creep)
- `src/app/api/admin/theme-projects/[id]/route.ts:18` uses `MANAGE_USERS`; sibling program powers use `MANAGE_PROGRAM`. Effectively reopens a project past global close.
- Fix: require `MANAGE_PROGRAM`.

### L2 — Slack staff-channel `mark_helped` lacks membership check
- `src/app/api/slack/interactions/route.ts:121-158` explicitly skips permission check; thread path `:233-238` correctly gates with `isChannelMember`. HMAC (`:272-282`) prevents forging today, but gap remains for future actions / leaked ts pairs.
- Fix: add same `isChannelMember` check + assert `payload.channel.id === TICKETS_CHANNEL`.

### L3 — Revoked session valid up to 5 min via cookie cache
- `src/lib/auth.ts:169-176` (`cookieCache.maxAge 5*60, jwe`); guards re-read roles (`src/lib/guards.ts:33`) but not revocation. Sign-out / user-delete still passes `requireSession` for ≤5 min.
- Fix (if needed): bypass cache on sensitive routes (`/api/admin/*`, `/api/shop/orders`, submit/dispute), or document as accepted.

### L4 — `httpsUrl` validator name lies (allows `http:`)
- `src/lib/schemas/common.ts:8-20` allows `http:`; used for `shopItem.imageUrl`, project links. Enables MITM image/link swap + mixed content.
- Fix: restrict to `https:` or rename.

### L5 — `public-origin.ts` trusts `x-forwarded-host/proto` first
- `src/lib/public-origin.ts:17-22` — used for redirects (`proxy.ts:114`, handoff). If ingress doesn't strip/spoof-proof, host-poisoning → cache-poison/open-redirect.
- Fix: ensure ingress overwrites these headers.

### L6 — `JSON.parse(action.value)` without try/catch → 500 on malformed Slack payload
- `src/app/api/slack/interactions/route.ts:126,169,225,293`. Slack signs the body, so low exploitability, but corrupt state = unhandled 500.
- Fix: wrap in try → ignore (pattern already used in `src/app/api/slack/events/route.ts:232`).

### L7 — Handoff single-use can be re-armed on R2 failure
- `src/lib/handoff.ts:163-168` resets `usedAt=null` if `putObject` throws. Attacker with QR photo forcing R2 failure gets extra attempts.
- Fix: single retry counter instead of full re-arm. Design otherwise excellent (32B `randomBytes`, sha256-only storage, guarded `updateMany`, owner-pinned key `:157`, 10-min TTL).

### L8 — Rate limiting is per-process in-memory, not shared
- `src/lib/api.ts:138-149`, `src/lib/site/signups.ts:291-303` (`8/min/IP`, cleared on restart). Fine for abuse-friction, not a security boundary; distributed burst bypasses.
- Fix: Redis/Upstash if relied upon for finance-relevant throttling. Note also `src/lib/auth.ts:150-154` relaxes `/sign-in/social` to 30/10s — revisit downward post-launch + WAF.

### L9 — Audit/HCB side-effects outside `$transaction`
- `src/app/api/admin/credits/route.ts:53-66`, `src/lib/shop.ts:213-337` (no purchase audit), `src/lib/grants.ts:207-228` — ledger commits, audit/HCB memo can fail → missing trail. Acceptable (audit must not roll back money) but add outbox/retry or `catch+alert`.

### L10 — Upstream error bodies logged verbatim may carry PII
- `src/lib/site/signups.ts:146,168,189`, `src/lib/site/slack.ts:68-70,179`, `src/lib/auth.ts:92-104` — labels only, but upstream response text is interpolated.
- Fix: redact `email` in these three sites.

### L11 — `subscribe` route skips zod
- `src/app/api/subscribe/route.ts:6-36` — manual `trim+slice(128)` instead of repo-standard `parseBody`/zod. Low exploitability, inconsistent.
- Fix: wrap in zod.

### L12 — Staging basic-auth leaves `api/upload/*` open by design — verify guards
- `src/proxy.ts:120-136` excludes `api/upload`, `api/handoff/upload`, etc. from basic-auth. App-level session guards must hold (comment says they live in `lib/guards`).
- Action: confirm each upload route enforces its guard.

## Notes / residual (by design, no action unless risk appetite changes)

- Secrets: `.env` gitignored (` .gitignore:34`), only `.env.example` tracked with empty secrets; no `NEXT_PUBLIC_*SECRET/KEY/TOKEN`; `server-only` on `auth.ts:1`, `pii.ts:1`, `integration-auth.ts:1`. Good.
- `Dockerfile:38` build-time `BETTER_AUTH_SECRET` placeholder is builder-stage only; runner (`:52-67`) doesn't re-set. Don't copy pattern to runtime. Runner copies `src/`+`scripts/` (`:90-92`) — widens image; `scripts/verify-pii.ts:73-87` cookie-forging helper is script-only, never a route — keep it that way.
- PII: AES-256-GCM via `src/lib/pii.ts:14-31`, never to browser (`auth.ts:225-232`, JWE cookie cache). Residual plaintext outflows are intentional: Airtable `POST {email,ip}` (`site/signups.ts:172-186`), optional webhook (`:195-217`), on-disk `./data/signups.jsonl` (gitignored), `syncHcaProfile` plaintext slackId/displayName (`hca-profile.ts:285-311`).
- Headers/CSP (`next.config.ts:67-84` + `proxy.ts:20-37`): `DENY` framing, `nosniff`, strict referrer, restrictive permissions-policy, HSTS. Deliberately no `script-src/style-src` — track nonce-CSP follow-up. No wildcard CORS. CSRF via better-auth origin check + HMAC (Slack/ARI/machine tokens, constant-time compare).
- Slack manifest (`slack-app-manifest.yml:33-69`): least-privilege scopes, `org_deploy:false`. Hardcoded prod `request_url` — staging needs second app or rewrite. Missing `SLACK_SIGNING_SECRET` fails closed (401).
- `HCB_REFRESH_TOKEN` rotation not persisted (`hcb.ts:42-57,74`) — pod restart loses it. Operational, not exploitable.

## Verified secure (no finding)

- SQL: only parameterized `$queryRaw` (`SELECT 1`, `pg_advisory_xact_lock(hashtextextended(...))`); no string-concat SQL.
- Command: no `child_process.exec/spawn/eval`; `exec(` hits are `RegExp.exec`.
- SSRF `from-url`: `src/lib/uploads/remote.ts:32-104` — scheme/port allowlist, IP `BlockList`, DNS-rebinding-safe `safeLookup`, redirect caps, `sniffImage` (SVG refused).
- Uploads now use presigned PUTs (`src/app/api/upload/presign`, `src/app/api/handoff/presign`): the key is minted server-side inside the caller's own prefix, the URL expires in five minutes, and `/confirm` re-checks the bucket's real size, video/image signature and (for pictures) the content hash the key is named after, deleting anything that fails. The old server-side `putObject` fallback is still present for browsers that cannot reach the bucket directly. Residual: a presigned PUT cannot bound the object size, so a minted URL can write up to R2's single-PUT limit before confirm deletes it; the window and the per-user/per-IP rate limits are what keep that small.
- Ownership IDOR spot-checks pass: `projects/[id]`, `sessions/[sessionId]`, `bom`, `hackatime`, `repo-sync`, `posts DELETE` (`updateMany where {id,userId}`), self-review refused (`review.ts:44,150`).
- ARI/Slack webhooks: HMAC + idempotency (`ari.ts:622-660`, `slack/events|interactions`).
- Public `GET /api/program`, `GET /api/signup-count`, `POST /api/subscribe`: no PII, rate-limited, no oracle.
