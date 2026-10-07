# The platform UI

The logged-in product for [Half Life](https://halflife.hackclub.com): ten weeks
of hardware for teenagers, laid out as a Duolingo-style trail of checkpoints.

Originally built in a separate repository as a front end with no server — dummy
data, `localStorage`, and every upload a boolean. It now runs on this repo's
Postgres, auth and R2. What follows is the original author's description of the
design, with the parts the merge changed marked.

```bash
pnpm install
pnpm dev     # http://localhost:3000
```

Signed out, `/` is the marketing page. Signed in, `proxy.ts` redirects it to the
trail at `/dashboard` — two route groups cannot both define `/`, and the landing page has its
own root layout and stylesheet.

To replay the first-run experience, clear the ceremony:

```js
localStorage.removeItem("halflife.ceremony.v4");
```

That only replays the intro. It cannot un-log a session or un-post a reel:
those are facts on the server, and only the ceremony lives in the browser.

## What is here

| Route | What it is |
| --- | --- |
| `/dashboard` | The checkpoint trail: 10 weeks, week banners, grand prize |
| `/explore` | Journal feed grouped by day |
| `/shop` | Coin shop, priced from the budget sheet |
| `/docs`, `/docs/[slug]` | Five short reference pages |
| `/reels` | Your own reels by project, and where you have posted them publicly |
| `/doomscroller` | Every reel anyone has posted |

## The curriculum

`src/lib/curriculum.ts` is the single source of truth for the programme shape,
and it encodes the Checkpoint framework exactly:

- **Week 1 (PCB, design)** — onboarding → a fork of idea reel or first
  journal (the reel is optional) → journal to the hours target → progress
  reel → submit (files, BOM/cart/tier, closing reel).
- **Design weeks 2–5** (CAD, music, displays, breadboard computer) — project
  creation with tier selection → idea reel → journal → reel → journal → reel →
  submit.
- **Build weeks 6–10** — the same five themes, built for real, ending in a
  submission that wants a 30–60 second video of the thing working, or an honest
  write-up of what needs to change.

Every journal entry is its own node, so the trail is as long as the work
actually was, and progress reels land at the entry where the clock crossed their
mark — five hours into a design week and every ten after that, two and a half
into a build and every five after that. Past the week's submit floor the trail forks rather than continuing: one
more session, or wrap the week up.

**Changed by the merge.** Tiers and the build-week ask now come from
`lib/config/`, which is where the ledger reads them too — one copy, because the
two disagreeing would mean the trail asking for different hours than the
reviewer paid for. Banking is paced by the printer you are saving for rather
than by your tier; see `docs/ARCHITECTURE.md`.

The project page carries the tier picker: every tier stays pickable until the
design week is submitted, and each one quotes its submit floor (`submitFloorFor`
— the funded block plus the banking the cheapest printer needs), not just the
funded hours. It writes `requestedTier`; the route refuses the change once
design is approved, or on a starter project. The same page links Hackatime
projects, which is how code hours reach a week's total.

## Where the data comes from

`lib/queries/store.ts` reads one snapshot per navigation — projects, checkpoint
states, coins, streak, goal — and `lib/store.tsx` hands it to the components
through the same `useStore()` interface they were written against. Every
derivation above that (what a week looks like, which node is live, what is
locked and why) is unchanged; only the source of the facts moved.

Writes post to the API routes and then ask Next to reload the snapshot, with a
local patch first so a click does not wait on a round trip to Postgres.

## First run

1. **Cinematic** (`components/platform/onboarding/Cinematic.tsx`) — one unbroken
   fall down the trail, from the whole platform to the printer at the bottom.
   Each week banner pins to the top of the frame while that week's checkpoints
   flow beneath it, exactly as it behaves on the real trail. Skippable; reduced
   motion parks on the prize.
2. **Spotlight** on the yellow first checkpoint.
3. **Setup** (`components/platform/modals/FirstCheckpoint.tsx`) — six steps:
   hardware experience → the week themes → PCB week → project creation with
   starter ideas → funding tier → time tracking.
   **Changed by the merge.** Finishing replays all six answers through the
   server's onboarding state machine in order. The machine refuses a step ahead
   of the furthest one reached, which is what stops anyone arriving at a funded
   project without having been asked what they are building.
4. **Tab tour** across the Doomscroller, Explore, Shop and Docs.

## Design system

Brand comes from the Figma file: Plus Jakarta Sans for display, Shantell Sans
for hand-lettered labels, and the cream / navy / sky / teal / magenta / coral /
orange palette. Two things carry the look:

- **`.sketch`** — a wobbling marker outline drawn on a pseudo-element by an SVG
  `feTurbulence` + `feDisplacementMap` filter, so every panel border is
  hand-drawn without touching the content it frames. `.torn` applies the same
  displacement to a filled shape, which is how the week banners and page signs
  get their torn-tape edge.
- **`.puck`** — the checkpoint token: a rim disc behind, a face on top, a real
  ambient shadow beneath, and a press that sinks the face onto the rim.

Filters live in `components/platform/art.tsx` (`SketchDefs`), mounted once in
the platform root layout. Every illustration — the fox, the five week scenes,
the printer, the shop objects, the reel backdrops — is authored SVG in that same
file. Icons are a single hand-drawn-adjacent set on a 24px grid at one stroke
weight (`components/platform/icons.tsx`).

The staff surfaces under `(ops)` — admin, review, login — keep this repo's
earlier design system in `(platform)/ops.css`, whole rather than
half-translated.

## Responsive

- **≥1280px** — rail + trail + Doomscroller.
- **1024–1279px** — rail + trail; the Doomscroller opens as a drawer.
- **<1024px** — top bar, bottom tab bar, full-width trail, Doomscroller as a
  sheet. Modals become bottom sheets.

The trail itself is resolution-independent: node positions are a sine function
of the checkpoint index expressed as a percentage of the column width, so the
curve holds from 360px to 1760px.
