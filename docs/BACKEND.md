# The Half Life backend

A handoff. Read this once before changing anything; the deeper reasoning lives in
[ARCHITECTURE.md](./ARCHITECTURE.md) (invariants) and [RUNBOOK.md](./RUNBOOK.md)
(operating it).

Half Life is a ten-week hardware programme. Participants design five projects and
then build all five, journalling as they go; approved work mints coins, and coins
buy a 3D printer at the end. The backend's job is to hold that economy honestly.

---

## Shape

Next.js 16 App Router, Postgres via Prisma 7, Cloudflare R2 for media,
better-auth against Hack Club Auth. One repo, four worlds:

| Route group | What it is |
| --- | --- |
| `(site)` | The marketing page. Own root layout and stylesheet. |
| `(platform)/(app)` | The logged-in product: trail, projects, shop, feed. |
| `(platform)/(ops)` | Admin, review, login. Carries `ops.css`, the earlier design system. |
| `(handoff)` | One public page: the phone upload a QR code opens. |

`proxy.ts` redirects `/` to `/dashboard` when a session cookie is present, so a
stranger gets the landing page and a participant lands on the trail, which has
its own URL.
That cookie check is optimistic and decides nothing — `(app)` runs
`requireSessionPage()`.

**There are no server actions.** Every write goes through `src/app/api/**`, which
means every write has one auditable entry point with a Zod schema on it.

```
src/lib/config/     every tunable number — tiers, printers, themes, weeks
src/lib/queries/    read paths (one per surface)
src/lib/*.ts        domain: currency, hours, review, shop, feed, handoff, streak
src/lib/schemas/    Zod, one per API area
src/app/api/        every write
prisma/schema.prisma
```

---

## The seam you most need to understand

The trail derives its **entire** shape — how many nodes a week has, where the
progress reels fall, which node is live, what is locked and why — from one pure
function, `curriculum.checkpointsFor()`, applied to one map of checkpoint states.

`lib/queries/store.ts` builds that map by reading the projects, sessions, posts
and submissions that already exist. `lib/store.tsx` hands it to the UI through
`useStore()`.

**There is deliberately no checkpoint table.** It would be a second source of
truth for "has this week had its idea reel", and the first time the two
disagreed the trail would lie to someone about work they had really done.

Reels bind to their node by `Post.checkpointKey`, not by counting posts of a
kind: the 10h and 20h reels are both `PROGRESS`, so counting would tick the 20h
node the moment the 10h one landed.

---

## Invariants worth protecting

**The ledger is append-only.** `reconcileGrant` reads a running sum and writes
the delta, so re-approving something converges instead of double-paying. It sums
**by kind** — so a new bucket needs a *new kind*, not the same kind with a
different bucket, or the two halves reconcile against each other's totals
forever.

**Two pots.** `SPENDABLE` buys anything; `BANKED` is the printer fund and buys a
printer only. `spendableFor()` is the only thing that decides which applies.

**Banking is paced by the printer, not the tier.** A tier decides how many of a
design week's hours the project itself eats (`fundingHours`); everything above
that banks at the rate the chosen machine needs (`goal.bankedHours`). Every tier
banks the same for the same printer. `lib/config/printers.ts` is the budget
spreadsheet transcribed — the season must land on each price, and
`verify:ledger` checks all eight machines.

**Hours have one implementation.** `rollUpHours()` decides what a phase is worth
and both the trail and the reviewer call it. Journal and Hackatime hours are
additive; timelapse duration is *not* (it is a recording of hours already
claimed).

**Uploads store keys, never URLs**, minted at read time so the bucket can move.
Keys are `<folder>/<userId>/<uuid>.<ext>` and are **not secrets** — the feed
returns a full video URL for every reel. Anywhere a client hands a key back,
check `isOwnedKey()`, or a stranger's timelapse becomes evidence for hours
nobody worked.

**Nobody reviews their own work**, and a build cannot be approved before its
design.

---

## Working on it

```bash
./dev.sh                  # Postgres in Docker, migrated, seeded, then next dev
pnpm typecheck && pnpm lint && pnpm build
```

Local scripts need `DATABASE_URL` in `.env` — every `package.json` script assumes
it, and without it Prisma silently falls back to a database named after your
shell user.

Schema changes: edit `prisma/schema.prisma`, then

```bash
pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script
```

(needs `SHADOW_DATABASE_URL`). Write the SQL by hand into a dated folder, rehearse
it against a scratch copy, and re-run the diff to confirm it comes back empty.

### The checks

Eight suites. They write to whatever `DATABASE_URL` points at and clean up after
themselves — **point them at a scratch database, never production.**

| | |
| --- | --- |
| `verify:ledger` | the economy: two pots, and every printer reachable |
| `verify:store` | the database-to-trail mapping |
| `verify:contracts` | client calls match route methods and schemas (no DB needed) |
| `verify:pii` | nothing private reaches a browser; staff surfaces refuse participants |
| `verify:onboarding` | the first checkpoint cannot be skipped |
| `verify:feed` | moderation actually removes things |
| `verify:handoff` | the QR upload token is single-use |
| `verify:uploads` | R2 round-trip smoke test |

`verify:pii` and `verify:contracts` exist because the compiler cannot see either
problem: an RSC serialises whatever it hands a client component into the HTML, so
a field nobody renders still ships; and a wrong HTTP method is a 405 that looks
identical to "the click did nothing".

---

## Traps that have already bitten

- **`ok()` returns the payload itself — there is no `data` envelope.** Only
  `fail()` wraps, in `{ error: { code, message } }`. Three clients assumed
  symmetry and threw on their first call.
- **`tsconfig` has `noUncheckedIndexedAccess`.** Index access is
  `T | undefined`. Where the real invariant is a fixed arity, write it as a tuple.
- **Prisma 7 moved things.** `migrate diff --from-migrations` needs a shadow
  database; `db execute` no longer takes `--url` (it reads `prisma.config.ts`).
- **The Docker image does not ship `scripts/`.** `grant-role` and the verify
  suites cannot run in a pod as-is.
- **`.env.example` comments live above values, not beside them** — a trailing
  comment gets copy-pasted into a deployment and a 32-character R2 key becomes 59.
- **Coins are minted at review approval, not when hours are logged.** The trail
  moves immediately because the node is the entry, not the payment.

---

## Open, and deliberate

- **R2 is public-read.** Anything uploaded is fetchable by URL, by anyone. Reels,
  journal photos, timelapses.
- **`/explore` publishes journal bodies to every participant.** Written for a
  reviewer, read by peers.
- **`/admin/feed` is post-only** — no way to unpin or remove an announcement
  without the moderation route.
- **Deadlines are soft by design.** A late joiner has to be able to finish, so
  almost nothing on the trail is hard-locked; the one real gate is that a build
  cannot be approved before its design.
