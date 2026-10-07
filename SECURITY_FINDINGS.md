# Security & Bug Audit — halflife

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
- No presigned-URL trust boundary — all uploads server-side `putObject` (`r2.ts:303`).
- Ownership IDOR spot-checks pass: `projects/[id]`, `sessions/[sessionId]`, `bom`, `hackatime`, `repo-sync`, `posts DELETE` (`updateMany where {id,userId}`), self-review refused (`review.ts:44,150`).
- ARI/Slack webhooks: HMAC + idempotency (`ari.ts:622-660`, `slack/events|interactions`).
- Public `GET /api/program`, `GET /api/signup-count`, `POST /api/subscribe`: no PII, rate-limited, no oracle.
