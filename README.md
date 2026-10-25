# Half Life

Hack Club's ten-week hardware programme. One repository, two worlds that are meant to look nothing alike:

- **The landing page** (`src/app/(site)`) – the marketing frame, built to the Figma **"landing page (claude)"** (`275:8`) with the palette from **"color scheme"** (`275:222`).
- **The platform** (`src/app/(platform)`) – the logged-in product: a Duolingo-style trail of checkpoints, a journal, a shop, and the Doomscroller. Documented in [docs/platform-ui.md](./docs/platform-ui.md).

Signed out, `/` is the landing page. Signed in, `proxy.ts` redirects it to the trail at `/dashboard`: two route groups cannot both define `/`, and each has its own root layout and stylesheet. The cookie check there is optimistic and decides nothing that matters – the real session guard is a server component.

```bash
pnpm install
./dev.sh      # Postgres in Docker, migrated and seeded, then next dev
```

New here? [docs/BACKEND.md](./docs/BACKEND.md) is the handoff – the shape, the invariants, and the traps that have already bitten. Beyond it: the visual system is [DESIGN.md](./DESIGN.md), the reasoning behind the invariants is [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), and operating it is [docs/RUNBOOK.md](./docs/RUNBOOK.md).

## What's where

```text
src/app/(site)/               the landing page
src/app/(platform)/(app)/     the trail, projects, shop, explore
src/app/(platform)/(ops)/     admin, review, login – earlier design system
src/app/(handoff)/            the phone upload page a QR code opens
src/app/api/                  every write in the product
src/components/site/          landing sections
src/components/platform/      the logged-in product's components
src/lib/config/               every tunable number: tiers, printers, programme
src/lib/curriculum.ts         the shape of a week, as a pure function
src/lib/queries/store.ts      the trail's data, read in one pass
src/lib/store.tsx             that snapshot, plus every write the trail makes
prisma/contract.prisma        the data model
public/art/                   hero painting, scatter photos, comp SVG exports
```

## Checking it still works

```bash
pnpm typecheck && pnpm lint && pnpm build
pnpm verify:ledger      # the economy: two pots, and every printer reachable
pnpm verify:store       # the database-to-trail mapping
pnpm verify:onboarding  # the first checkpoint cannot be skipped
pnpm verify:feed        # moderation actually removes things
pnpm verify:handoff     # the QR upload token is single-use
```

The verify scripts write to whatever `DATABASE_URL` points at and clean up after themselves. Point them at a scratch database, never production.

## Things you'll want to swap

### 1. The logo

`src/components/wordmark.tsx` sets the wordmark in live type by default. Drop your artwork in `public/brand/` and set one constant:

```ts
const LOGO_SRC = "/brand/half-life-wordmark.svg";
const LOGO_ASPECT = 981 / 261; // your file's width ÷ height
```

The comp reserves a 981 × 261 box. The slot fills its width either way, so nothing else changes.

### 2. The step photos and project photos

Every reserved photo is an `<ImageSlot>` – an ink plate with cyan registration ticks and the artwork's native size printed in it, so an empty slot reads as a deliberate footprint rather than a broken image. Each one tells you its size:

| Where                          | Native size | File                                  |
| ------------------------------ | ----------- | ------------------------------------- |
| Step 2 – "get funding…"        | 736 × 155   | `src/components/process.tsx`          |
| Step 3 – "then spend 5 weeks…" | 736 × 269   | `src/components/process.tsx`          |
| Step 4 – "get a 3D printer!"   | 736 × 269   | `src/components/process.tsx`          |
| Carousel cards (×5)            | 329 × 377   | `src/lib/content.ts` → `BUILD_CARDS`  |

Replace an `<ImageSlot …/>` with `<Image …/>` in the same wrapper – the box is already the comp's box.

### 3. Where the emails go

`POST /api/subscribe` validates, normalises and de-duplicates, then writes to one of two sinks:

| Env                     | Behaviour                                                        |
| ----------------------- | ---------------------------------------------------------------- |
| `SIGNUP_WEBHOOK_URL`    | `POST { email, ip, source, referralCode, ref, utmSource, utmMedium, utmCampaign }` to your list provider or relay |
| `SIGNUP_WEBHOOK_TOKEN`  | optional `Authorization: Bearer …` for that webhook              |
| *(neither set)*         | appends JSON Lines to `./data/signups.jsonl` (gitignored)         |

The file sink is fine for local development and any host with a writable disk. **It is not durable on serverless** – point `SIGNUP_WEBHOOK_URL` at a real provider before launch. The rate limit is per-instance and coarse; put Vercel BotID or a WAF rule in front of the route for real abuse protection.

### 4. The Slack bot

`src/app/api/slack/events/` and `src/app/api/slack/interactions/` back a bot that:

- invites anyone who joins the main Half Life channel into `#half-life-bulletin` and `#half-life-help`
- posts every new top-level message in `#half-life-help` into a private tickets channel with a **mark as helped** button (anyone with access to that channel can click it), and replies in-thread in `#half-life-help` with an **i've got it, thanks** button that only the ticket's own author can click
- reacts to that message with `:safari-loading:` while the ticket is open, and swaps it for `:white-checkbox-checkbox-checkbox:` – the workspace's custom "done" emoji – the moment it's resolved, so the channel reads at a glance which questions are still waiting

Either button resolves the ticket: the bot **deletes its own message** in the tickets channel, so a resolved ticket leaves the queue instead of lingering there struck through, and it edits its own button message in `#half-life-help` in place. The thread keeps the question and the "you're all set" ack, so the record survives where anyone would look for it. A button's own `value` carries the pointer to the other message it has to touch, except that the tickets-channel button – clicked from the other side – reads the help thread back to find the reminder it rewrites. One known gap: if staff resolve a ticket first, the author's button is left active, and clicking it afterward does nothing to the tickets channel – the message is already gone – though it still acks the thread.

Create the app from `slack-app-manifest.yml` at the repo root (see the comments in that file for the exact steps), then set:

| Env                          | What                                                      |
| ----------------------------- | ---------------------------------------------------------- |
| `SLACK_BOT_TOKEN`             | Bot User OAuth Token (`xoxb-…`)                            |
| `SLACK_SIGNING_SECRET`        | Basic Information → Signing Secret, verifies both routes  |
| `SLACK_MAIN_CHANNEL_ID`       | channel that triggers the auto-invite                      |
| `SLACK_BULLETIN_CHANNEL_ID`   | `#half-life-bulletin`'s channel ID                          |
| `SLACK_HELP_CHANNEL_ID`       | `#half-life-help`'s channel ID                               |
| `SLACK_TICKETS_CHANNEL_ID`    | private channel new/resolved tickets get posted to         |
| `SLACK_REVIEW_CHANNEL_ID`     | `#half-life-review`: the daily review summary              |
| `SLACK_DISPUTES_CHANNEL_ID`   | `#half-life-disputes`: review disputes                     |

The bot needs to be a member of all of these channels – invite it manually after installing.

### 5. Facts to confirm before launch

- The carousel credits are the real makers from the platform art (`src/lib/site/content.ts`); give them a read before they ship.
- Hack Club's EIN (`81-2908499`) is in the footer. Confirm it and decide whether you also want the mailing address, which the Hack Club footer carries.
- FAQ card six ("What do I get?") replaces a duplicated "What's Hack Club?" in the comp. Its copy is assembled from facts the comp already states.

## Responsive behaviour

Two layouts, on purpose:

- **≥ 1180px** – `.stage` reproduces the comp's 1728px grid exactly. Every offset is written as its literal Figma pixel and resolved in `cqw`, so the composition scales continuously instead of snapping.
- **< 1180px** – the same content stacked, with the connector bands re-drawn as short vertical tapers between plates.
