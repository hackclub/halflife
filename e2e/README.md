# Browser tests

Playwright drives the real app, a real Postgres database and a real browser. Unit tests stay on Bun (`bun test src`); these are the full-stack checks for routing, cookies, guards and writes.

## Running

```bash
bun run e2e:install   # once per machine: Chromium + system dependencies
bun run test:e2e      # recreate the E2E database, start Next on :3100, run the suite
```

On a machine whose system libraries already satisfy Playwright, `bunx playwright install chromium` is enough; the extra `--with-deps` in `e2e:install` installs those libraries too.

Other entry points:

```bash
bun run e2e:db          # only recreate/migrate/seed the E2E database
bun run test:e2e:only   # run Playwright against an existing database
bun run test:e2e:ui     # Playwright's UI mode
```

The suite expects Postgres on `127.0.0.1:5432` with `postgres`/`postgres`, or `E2E_DATABASE_URL` pointing at another loopback server. The database name must end in `_e2e`: the reset script drops and recreates it. It refuses to run against anything else, so a local `.env` cannot redirect it at the dev database by accident.

Stop `next dev` before running locally. The test server uses the ordinary `.next` directory (a custom `distDir` breaks Prisma's external `pg` module under Next 16), so two dev servers cannot share the checkout at once.

Spec files deliberately avoid TypeScript-only syntax. Playwright run through Bun (where `node` is a Bun alias on some machines) does not erase type annotations in test entrypoints, and a typed spec fails to load before any test runs. Typed helpers live in ordinary modules such as `e2e/db.ts` and `e2e/onboarding-helpers.ts`; CI runs Playwright under Node and accepts either style.

## How auth works

There is no test login route. The fixture inserts a `user`, a `session` and any `user_role` rows directly, then signs the session token the way better-auth does:

```
token + "." + base64(HMAC-SHA256(token, BETTER_AUTH_SECRET))
```

The cookie is `__Secure-better-auth.session_token`, because the app's dynamic `baseURL` config uses the `https` protocol even on localhost. Before a test does any work, the fixture calls `/api/auth/get-session` and fails with a pointed message if the cookie was not accepted. A better-auth upgrade that changes the format breaks one check, not every test.

Each test gets its own user and browser context. Roles: `participant` has no role rows, `admin` and `reviewer` get their row. `openAs({ ... })` creates a user with custom options (for example `coins`, `onboarding: "new"`, `verified: false`).

## Isolation

- **Database:** dedicated `halflife_e2e`, reset on every `test:e2e` run, seeded with a program start four weeks back so week 1 is always open.
- **Server:** port `3100`, its own env via `webServer.env`, `reuseExistingServer: false`.
- **Network:** the server refuses non-loopback `fetch` (`src/instrumentation.ts`, gated by `E2E_BLOCK_EXTERNAL_FETCH`) and every browser context aborts non-loopback requests. HCA, GitHub, Airtable, Slack and Plausible are never reached. A real integration call fails loudly instead of quietly using a developer's `.env` credentials. The `Discovery fetch failed for "hca"` line at server start is expected: HCA discovery is pointed at a dead loopback endpoint, and the provider's pinned URLs keep it registered for tests that never sign in.

## Files

```text
playwright.config.ts
e2e/env.ts        the port, database URL and server environment
e2e/auth.ts       session cookie signing
e2e/db.ts         user/role/session/ledger inserts with pg
e2e/fixtures.ts   participant, admin, reviewer and openAs fixtures
e2e/*.spec.ts     the tests
scripts/e2e-db.ts drop, create, migrate, seed
```

## Covered today

- The landing page, the login page and `/api/health`.
- A signed-out visitor is redirected from `/dashboard` to the landing page.
- A forged session cookie is rejected, and `/signed-out` clears it.
- Participants get a 404 from `/admin` and `/review`; admins see the admin overview and reviewers see the review queue.
- Signing out clears the session, and the server guard agrees on the next request.
- Both onboarding branches: a custom project through the tier step, and a starter project that skips it.
- The browser timezone is captured into the account.
- An affordable shop purchase writes an order and debits the ledger; an unaffordable one is refused before any request.
- An admin changes program settings and finds the change in the audit log.
- A reviewer claims a design submission, rejects it with feedback, and the project, review row and audit entry agree.
