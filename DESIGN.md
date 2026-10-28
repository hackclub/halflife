---
name: Half Life
description: A ten-week hardware programme from Hack Club – a marketing world, a platform world, and the staff console, deliberately unalike.
colors:
  # ── Landing page (src/app/(site)/globals.css) ──────────────────────────────
  hl-ink: "#31222c"
  hl-paper: "#ededed"
  hl-cyan: "#8ed3dc"
  hl-blue: "#88BCDF"
  hl-blue-deep: "#0E86B9"
  hl-blue-pale: "#9AB5D8"
  hl-teal: "#2E96A3"
  hl-teal-deep: "#11616B"
  hl-periwinkle: "#a39bd6"
  hl-lavender: "#c9c7ec"
  hl-lavender-pale: "#E6E5FC"
  hl-indigo: "#34316c"
  hl-yellow: "#A2C4DA"
  hl-yellow-pale: "#EBF7FF"
  # ── Platform (src/app/(platform)/globals.css) ──────────────────────────────
  cream: "#fcf7f7"
  paper: "#ffffff"
  navy: "#1c1a59"
  navy-soft: "#4a4785"
  ink: "#262a2d"
  sky: "#52b4d5"
  sky-deep: "#2e8cae"
  sky-pale: "#cfeaf4"
  teal: "#06ae97"
  teal-deep: "#048372"
  teal-mid: "#75d0c9"
  mint: "#aef2dd"
  teal-grey: "#b3c7c3"
  teal-grey-deep: "#86a09b"
  magenta: "#b21b9b"
  coral: "#f35757"
  coral-deep: "#c73b3b"
  orange: "#fba62f"
  orange-deep: "#d07f0e"
  violet: "#a47cc0"
  violet-deep: "#7b519b"
  violet-pale: "#ece2f2"
  sand: "#f4dfc6"
  sand-deep: "#cdae8a"
  gold: "#f6c63f"
  gold-deep: "#c9930f"
  gold-pale: "#fdf1cc"
  line: "#c8c3d6"
  line-strong: "#9a94b4"
  # Text-only inks and a field edge: see "Measured contrast".
  sky-ink: "#236b85"
  teal-ink: "#037365"
  gold-ink: "#7f5c07"
  orange-ink: "#8c5507"
  sand-ink: "#8a6c4b"
  navy-faint: "#676386"
  field: "#86829f"
  violet-dark: "#613f7b"
  teal-dark: "#025a4f"
  coral-dark: "#a53131"
  # ── Staff console (src/app/(platform)/ops.css) ─────────────────────────────
  # The platform's earlier system, kept whole for admin, review and login. In
  # ops.css these are plain `--color-*` names scoped to the (ops) route group;
  # the `ops-` prefix is this document's, so they cannot be confused with the
  # platform tokens they share names with.
  ops-surface: "#fcf7f7"
  ops-surface-raised: "#ffffff"
  ops-surface-sunken: "#f2ecec"
  ops-border: "#cacedd"
  ops-ink: "#100f30"
  ops-ink-strong: "#1c1a59"
  ops-ink-muted: "#696e82"
  ops-accent: "#52b4d5"
  ops-accent-bright: "#61cdf1"
  ops-teal: "#06ae97"
  ops-mint: "#aef2dd"
  ops-magenta: "#b21b9b"
  ops-coin: "#fba62f"
  ops-flame: "#f35757"
typography:
  site-display:
    fontFamily: "Ubuntu, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 700
    letterSpacing: "-0.02em"
  site-body:
    fontFamily: "Open Sans, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 400
    lineHeight: 1.5
  site-hand:
    fontFamily: "Masterpiece, Ubuntu, cursive"
    fontWeight: 400
  site-tagline:
    fontFamily: "Ubuntu, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 400
    lineHeight: 1.1
  app-display:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 4vw, 3.75rem)"
    fontWeight: 800
    lineHeight: 1.05
  app-headline:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.9rem"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  app-title:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 800
  app-body:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1.5
  # The hand-lettered voice. The comp names COMICO, which is not on Google
  # Fonts and ships no licensed file here; Shantell Sans is the substitute in
  # use, and `--font-hand` is the one place to change that.
  app-hand:
    fontFamily: "Shantell Sans, Plus Jakarta Sans, ui-sans-serif, sans-serif"
    fontSize: "0.84rem"
    fontWeight: 500
    letterSpacing: "0.04em"
  app-label:
    fontFamily: "Shantell Sans, Plus Jakarta Sans, ui-sans-serif, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 700
    letterSpacing: "0.11em"
    lineHeight: 1.25
    textTransform: "uppercase"
rounded:
  control: "4px"
  button: "8px"
  panel: "10px"
  rail: "14px"
  square: "0px"
  # The platform's own radius, on every sketched border unless overridden.
  hl: "16px"
  hl-button: "12px"
  pill: "999px"
spacing:
  tight: "0.75rem"
  base: "1rem"
  stack: "1.5rem"
  card: "1.4rem 1.5rem"
  gutter: "2.4rem"
components:
  # ── Platform ───────────────────────────────────────────────────────────────
  button-solid:
    backgroundColor: "{colors.violet}"
    textColor: "{colors.paper}"
    rounded: "{rounded.hl-button}"
    height: "2.75rem"
    padding: "0 1.25rem"
    typography: "{typography.app-label}"
  button-gold:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.navy}"
    rounded: "{rounded.hl-button}"
  button-teal:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.paper}"
    rounded: "{rounded.hl-button}"
  button-coral:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.paper}"
    rounded: "{rounded.hl-button}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.navy}"
    rounded: "{rounded.hl-button}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.navy-soft}"
    rounded: "{rounded.hl-button}"
  chip-violet:
    backgroundColor: "{colors.violet-pale}"
    textColor: "{colors.violet-deep}"
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.625rem"
    typography: "{typography.app-label}"
  chip-muted:
    backgroundColor: "rgba(0, 0, 0, 0.05)"
    textColor: "{colors.navy-soft}"
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.625rem"
    typography: "{typography.app-label}"
  # A drawn border on a pseudo-element, so the wobble never touches the content
  # it frames. `.sketch` for an outline, `.torn` for a filled shape.
  panel-sketch:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.hl}"
  # The checkpoint token: a rim disc offset beneath a face disc. The face is
  # the colour below; the rim is its deep tone.
  puck-open:
    backgroundColor: "{colors.sky}"
  puck-done:
    backgroundColor: "{colors.teal}"
  puck-gate:
    backgroundColor: "{colors.magenta}"
  puck-onboarding:
    backgroundColor: "{colors.gold}"
  puck-locked:
    backgroundColor: "{colors.sand}"
  puck-passed:
    backgroundColor: "{colors.teal-grey}"
  # ── Staff console ──────────────────────────────────────────────────────────
  ops-button-primary:
    backgroundColor: "{colors.ops-accent-bright}"
    textColor: "{colors.ops-ink-strong}"
    rounded: "{rounded.button}"
    padding: "0.5rem 1.1rem"
  ops-button-default:
    backgroundColor: "{colors.ops-surface-raised}"
    textColor: "{colors.ops-ink-strong}"
    rounded: "{rounded.button}"
    padding: "0.5rem 1.1rem"
  ops-button-danger:
    backgroundColor: "{colors.ops-flame}"
    textColor: "{colors.ops-surface-raised}"
    rounded: "{rounded.button}"
    padding: "0.5rem 1.1rem"
  ops-card:
    rounded: "{rounded.panel}"
    padding: "{spacing.card}"
    textColor: "{colors.ops-ink}"
  ops-input:
    backgroundColor: "{colors.ops-surface-raised}"
    textColor: "{colors.ops-ink}"
    rounded: "{rounded.button}"
    padding: "0.6rem 0.75rem"
---

# Design System: Half Life

## Overview

Half Life runs **two visual worlds on purpose**, and the split is the first thing to understand before writing any screen. The marketing site sells a ten-week hardware programme to teenagers who have never soldered anything. The platform is where those same teenagers then work, for ten weeks, most days. A world that serves the first badly serves the second, so they were never merged.

There is a third, which is not a world so much as a back room: the staff console under `(ops)` – admin, review, login – carries the platform's earlier design system in `ops.css`, kept rather than half-translated when the participant platform was rebuilt from the comp. In the CSS its tokens are plain `--color-*` names; this document prefixes them `ops-` so they cannot be mistaken for the platform's. It redefines names the platform also uses (`ink`, `teal`, `mint`, `magenta`), so the stylesheet scopes them to `.ops-root`, the wrapper the console and the phone handoff page render inside: on `:root` they would quietly repaint the trail after a navigation. The stylesheet is plain CSS over the platform's Tailwind, not a second copy of it.

**Landing page – Creative North Star: "The Production Line"**

A ten-week hardware production line, drawn as the line itself. The page reads like control-panel silkscreen laid over a workshop: flat plates, square-cut bands, no shadows, and a thick band that physically welds each stage of the programme to the next. The ground is ink and the informational plates are paper, because this is read on a phone in a bedroom or a school laptop, and the copy deserves the highest-contrast surface on the page. Energetic and workshop-bright rather than sleek – the promise is a soldering iron, not a SaaS trial.

**Platform – Creative North Star: "The Field Notebook"**

Every outline is a drawn ink stroke rather than a rectangle: card borders wobble, the week arrives as a band of torn painted paper, and page titles hang from straps on torn plates. It reads as something kept by hand alongside the hardware, which is what journalling and timelapses actually are. Where the landing page is ink-grounded and engineered, the platform is paper-grounded and warm, and its structure is a path you walk rather than a page you read. Even the one screen that borrows a familiar layout – the Doomscroller's reel player – is drawn in the notebook's hand rather than as a dark cinema.

**Key Characteristics:**

- Two grounds, never mixed: `#31222c` ink for the landing, `#fcf7f7` warm paper for the platform, with a faint 28px graph-paper tooth so the cream reads as paper rather than dimmed white.
- The landing is flat and mostly square; the platform has drawn edges, pucks that sit on a rim, and a few stickers lifted off the page.
- The platform's borders are drawn, not declared: `.sketch` puts a wobbling marker outline on a pseudo-element so the line never touches the content it frames, and `.torn` applies the same displacement to a filled shape – which is how the week banners and page signs get their torn-tape edge.
- Its checkpoint token is the `.puck`: a rim disc offset beneath a face disc, an ambient shadow under both, and a press that sinks the face onto the rim.
- The platform's primary structure is a progress path, not a dashboard of cards.
- Illustration is the programme's own: a cast of fox and gato characters and five theme paintings, all die-cut stickers with a pale outline.
- Text is navy and navy-soft, never neutral grey; the hand face writes the asides in the margin.

## Colors

Three palettes. Nothing crosses between the landing and the platform; the staff console's is the platform's own ancestor and is named apart so the two cannot be confused for each other.

### Primary

- **Programme Cyan** (`#8ed3dc`): the landing page's accent – primary CTA, focus ring, and the stroke on the process band's ground pattern.
- **Violet** (`#a47cc0`): the platform's action colour – every primary button, the outline button's border, and anything pressed-on in a conversation (an open comments button). Its deep tone rims the solid button.
- **Sky** (`#52b4d5`): the platform's accent. Links, the Explore sign, and the face of a checkpoint you can open.

### Secondary

- **Deep Ink Navy** (`#1c1a59`): the platform's structural colour – all body text, every heading, the straps page titles hang from, the "Start here" callout. Carries more of the platform's identity than any accent.
- **Programme Teal** (`#06ae97`): completion. Finished checkpoints, progress fills and the Doomscroller's progress bar (`teal-mid` over video), switches that are on.
- **Mint** (`#aef2dd`): the soft half of teal – unfilled progress tracks, the "already completed" hover bubble, secondary hover fills, text selection.
- **Magenta** (`#b21b9b`): the hand-in. Submit checkpoints, and the keyboard focus ring.

### Tertiary

- **Coin Orange** (`#fba62f`) and **Streak Red / Coral** (`#f35757`): the two counters, and by extension warning and danger. Coral also marks a like, the active nav item's dot and the nav card's torn tab.
- **Gold** (`#f6c63f`): the first checkpoint (setup) and the grand prize – it stays gold after it is done, as the landmark the trail starts from.
- **Sand** (`#f4dfc6`): locked – a checkpoint not yet reachable, and the hover bubble that says why.
- **Teal Grey** (`#b3c7c3`): passed – every checkpoint of a week whose time has run out. Teal with the life drained out, so it reads as time that ended, not a step still waiting.
- **Periwinkle** (`#a39bd6`) and **Lavender** (`#c9c7ec`): the landing's band and aside plates.

### Neutral

- **Ink** (`#31222c` landing): body text, and the landing's page ground.
- **Paper** (`#ededed` landing / `#fcf7f7` cream platform): the landing's plates; the platform's entire ground. The platform's is deliberately warm rather than white – white (`#ffffff`) appears only on panels that sit on top of it.
- **Navy Soft** (`#4a4785`): platform secondary text, captions, the hand-lettered asides.
- **Line** (`#c8c3d6`): every drawn border and dashed rule on the platform.
- **Line Strong** (`#9a94b4`): outlines on controls and dotted connectors. Decorative only – see the measured contrast.

### Named Rules

**The Two Worlds Rule.** A token from one world never appears in the other. If a platform screen needs an accent, it is `sky`, not `hl-cyan`. The two palettes do not share a single value, and a screen that mixes them belongs to neither.

**The Tinted Secondary Rule.** Secondary text is tinted from its own surface, never neutral grey. The landing derives `hl-ink-soft` as ink at 80% over paper and `hl-paper-soft` as paper at 78% over ink. The platform's secondary text is `navy-soft`, the navy hue lifted until it reads as a second voice.

**The State Colour Rule.** On the trail a puck's colour is its state, and each state owns one hue: sky open, teal done, magenta hand-in, gold setup, sand locked, teal-grey passed. Don't reuse these hues on a puck for anything else.

**The Misnamed Yellow Rule.** `--color-hl-yellow` (`#A2C4DA`) and `--color-hl-yellow-pale` (`#EBF7FF`) are **blue**. The landing was recoloured after those variables were named and the names were never updated, so the carousel cards read as pale blue while the code says yellow. Trust the value, not the name – and rename them before adding anything new that uses them.

### Measured contrast

Recomputed against the current CSS, not inherited from an earlier palette.

Landing: ink on paper 12.85:1 · ink on cyan 8.96:1 · ink on periwinkle 5.89:1 · ink on lavender 9.22:1 · indigo on lavender 7.14:1 · ink on lavender-pale 12.16:1 · ink on `hl-yellow` 8.20:1 · ink on `hl-yellow-pale` 13.81:1 · white on `hl-teal-deep` 7.13:1. White on `hl-blue-deep` is **4.09:1** and paper on it **3.50:1**, so that plate takes large text only (≥24px, or ≥18.66px bold).

Platform, text on cream: navy 14.75:1 · navy-soft 7.82:1 · violet-deep 5.67:1 · magenta 5.62:1 · coral-deep 4.81:1 · teal-deep 4.40:1. Fills with navy text: gold 9.74:1 · mint 12.33:1 · sand 12.09:1. White on violet-deep 6.01:1 · magenta 5.96:1 · coral-deep 5.10:1 · teal-deep 4.67:1 · navy 15.66:1.

**Resolved by adding text-only tones, not by changing the brand's fills.** The deep tones stay rims and borders; anything set as *text* in those hues takes an ink that clears 4.5:1 on cream, white and every pale chip fill:

- **Inks:** `sky-ink` (was sky-deep, 3.61), `teal-ink` (teal-deep, 4.40), `gold-ink` (gold-deep, 2.58), `orange-ink` (orange-deep, 2.94). Coral text is `coral-deep`, violet text `violet-deep`, and on a coral tint (`coral/10`, `/15`, where coral-deep falls to 4.06-4.30) it is `coral-dark`.
- **Quiet text** that used to be `line-strong` (2.72) is `navy-faint` (5.34:1), which is also every placeholder.
- **Solid buttons** fill with the deep tone and rim and hover one darker (`violet-dark`, `teal-dark`, `coral-dark`): white reads 6.01, 4.67 and 5.10.
- **On an accent fill** the text is navy – `onAccent()` in `ui.tsx` – except on magenta, the one fill white reads on. A label "in the week's colour" on cream goes through `accentText()`, which swaps each accent for its ink.
- **Fields** are edged in `field` (3.68:1 on white), the 3:1 a control's boundary needs; `line` (1.72) is for dividers only.
- **Puck glyphs:** a passed glyph is navy-soft on teal-grey (4.69), a padlock `sand-ink` on sand (3.75).

**Still below the line, and why:** the white glyph on a sky, teal or orange puck (2.37, 2.80, 1.98 against the 3:1 an icon needs). It is the trail's signature and every puck is also labelled, so it is left for a design decision rather than repainted. Decorative marks – the dotted connectors, the dashed `line` rules, panel outlines – carry no information and are exempt.

## Typography

**Landing – Display and Tagline:** Ubuntu · **Body:** Open Sans · **Hand:** Masterpiece (the wordmark). **Platform – Display and Body:** Plus Jakarta Sans · **Hand:** Shantell Sans.

**Character:** The landing pairs a friendly geometric sans for everything that shouts with a neutral workhorse body, and keeps its brush face for the wordmark alone. The platform runs one humanist sans for everything structural and reserves a hand-lettered face for small uppercase labels, margin asides and timestamps – the only place its voice gets loose.

### Hierarchy

- **Display** (Plus Jakarta 800, `clamp(1.75rem, 4vw, 3.75rem)`, 1.05): the page title on its hanging sign. One per screen.
- **Headline** (Plus Jakarta 800, 1.25rem → 1.75rem, 1): the week banner's "DESIGN YOUR PCB"; a project's name on its page (up to 1.9rem, −0.03em).
- **Title** (Plus Jakarta 800, 0.95rem): timeline headlines ("Journal entry", "Posted a reel"), reel authors, card names.
- **Body** (Plus Jakarta 400, 0.9-0.95rem, 1.5): descriptions, entries, comments. Journal bodies hold a 68ch measure.
- **Label** (`.label` – Shantell Sans 700, 0.78rem, +0.11em, uppercase): section headings, chips, button text, the week banner's "WEEK 1/10 · DESIGN".
- **Hand** (`.hand` – Shantell Sans 500, 0.84rem, +0.04em): the asides written in the margin – "that is everything. go build something.", timestamps, hours logged, "click to edit your entry."
- **Counter**: the coin and streak numerals, set in the display face at label size rather than in the hand, so two digits stay legible at a glance.

### Named Rules

**The One Size Per Role Rule.** Each role above has one size on a screen. Five near-identical hand sizes (12.2, 12.8, 13.1, 13.4, 13.8px) read as untidiness, not hierarchy; asides are 0.84rem, body 0.9rem, timeline titles 0.95rem.

**The Hand Is Not Body Rule.** The platform's hand-lettered face sets labels, asides and nothing longer – never a requirement or an instruction someone has to read to finish a task. The comp names COMICO, which is not on Google Fonts and ships no licensed file here; Shantell Sans stands in, loaded in the platform root layout and reached everywhere through `--font-hand`. Swapping it is that one variable, because no component names a face directly.

**The Brush Bookends Rule.** On the landing, Masterpiece is identity, never voice. It sets the wordmark and nothing else – it ships one 400 weight whose strokes overhang their advances (`I` carries 0.52em of ink on a 0.32em advance), so it is already heavy and a synthesised bold smears it. `font-synthesis-weight: none` is set for that reason.

**The Metric Drift Rule.** Ubuntu is not a drop-in for Open Sans. Against the same fallback reference Next scales Open Sans to 105.15% and Ubuntu to 102.06%, so Ubuntu sets about 3% smaller at the same `font-size`, and its declared ink box is 1.0984em against Open Sans's 1.2951em. Size the two independently.

## Layout

**Landing.** Two layouts on purpose. At ≥1180px a `.stage` reproduces the comp's 1728px grid exactly: every offset is written as its literal Figma pixel and resolved in `cqw`, so the composition scales continuously instead of snapping. Below 1180px the same content stacks, with the connector bands redrawn as short vertical tapers between plates.

**Platform.** A shell up to 1760px wide with three columns:

- **Left rail** (246px, 286px from xl): sticky, holding the logo, the nav card, the goal tracker (below xl) and the account card.
- **Content well:** each page sets its own measure – the trail 720px, Explore 780px, a project 960px.
- **Status rail** (316px, 352px from 2xl, xl and up): the goal tracker and the Doomscroller feed. Open by default on the trail only; it folds to nothing with a 420ms width transition, and the content keeps its width while it goes, so it is clipped rather than squashed.

Below lg (1024px) the left rail is gone: a sticky 64px header carries the logo and a Doomscroller link, and a fixed bottom tab bar carries the main destinations.

**The trail** swings its checkpoints along a sine (23% amplitude) down a single column. A milestone takes a full stride, and a journal entry a shorter one with a smaller puck, so a long week reads as rhythm rather than a queue. A stride is sized by the node it leaves, never by the one it arrives at, so a tall label never lands on the next puck.

**The Doomscroller** is a page of the platform, not a takeover. Its reel column is exactly as wide as a 9:16 card fits in the frame, less the player strip under it. The actions hang off its right side from md up, with that room reserved, and the comments stand beside it as a panel from xl or rise as a sheet below.

Rhythm is a small set of stack gaps: 0.75rem tight, 1.5rem standard, 2.4rem between columns. Sections on a page are 2rem apart, headed by a label.

## Elevation & Depth

**The landing is flat.** No shadows anywhere. Depth is tonal: plates of paper and lavender sit on an ink ground, and the bands that weld them are the plates' own material. Anything that needs to read as lifted is lifted by hue, not by blur.

**The platform is outlined, with a few things lifted off the page.** Panels and cards are outlined, never shadowed. What does lift:

- **Pucks.** The rim disc sits 9px below the face (7px when locked or passed, 11px for the gold setup puck), with an ambient shadow beneath both. The comp draws each node as two stacked ellipses, and the offset rim is that second ellipse. Pressing sinks the face onto the rim.
- **Stickers and torn plates** – the logo, week banners, page signs, the grand prize art – carry a soft drop, because they are paper stuck onto paper.
- **Reel cards** carry the lift shadow, because a video is an object on the desk rather than a region of the page.

### Shadow Vocabulary

- **Stack** (`0 2px 4px rgba(28,26,89,.06), 0 10px 26px -12px rgba(28,26,89,.28)`): the lowest lift.
- **Lift** (`0 3px 6px rgba(28,26,89,.08), 0 18px 40px -16px rgba(28,26,89,.38)`): reel cards.
- **Tape** (`0 3px 6px rgba(28,26,89,.1), 0 14px 30px -14px rgba(28,26,89,.4)`): torn banners and signs.
- **Sticker** (two stacked `drop-shadow`s, 3px/2px and 9px/13px at .16/.13): die-cut art.
- **Puck** (`0 10px 18px -6px rgba(28,26,89,.34)` under the rim): checkpoints.

All shadows are navy-tinted, never black.

### Named Rules

**The Outline-Not-Shadow Rule.** A panel, card, button or field is separated by a drawn outline and the page ground showing through, never by a shadow. If something needs separating, give it a border and a gap.

**The Paper-On-Paper Rule.** A shadow means an object sitting on the notebook – a puck, a sticker, a strip of tape, a reel. If it isn't something you could pick up, it doesn't get one.

## Shapes

**Landing:** square-cut bands and plates. The exceptions are the process step and aside plates, and the corner decal (`rounded-xl`), the FAQ rows (`rounded-md`), and the build carousel's cards and pill. The form language is plate-and-band: slabs joined by thick connectors.

**Platform:** soft and drawn.

- **Buttons and fields:** 12px.
- **Panels:** 16px by default (18-22px for large page panels).
- **The reel card:** 16px.
- **Chips, switches and round controls:** fully round.
- **Pucks:** circles.

The defining move is not the radius but the **stroke**: every border is a wobbling ink line generated by an SVG turbulence displacement – on the platform a slow wander, roughly 55px between wiggles with about 2px of travel either way, in three seeds so neighbours are not identical tracings. Torn shapes (week banners, page signs, the nav card's tab) use a stretched, rougher noise that tears along their long edge. The staff console's wobble is tighter, about 20px between wiggles.

Illustration carries its own shape language: every character and theme painting is a die-cut sticker with a pale outline baked into the art.

### Named Rules

**The Drawn Edge Rule.** A platform border is drawn, not stroked. Use `.sketch` (or `.sketch-2` / `.sketch-3`, which carry different seeds) rather than a CSS border, and vary which one between adjacent cards. Two cards with the same wobble read as a repeated texture, which is the opposite of hand-made. In the staff console the equivalent is `.hl-wobbly` plus `<WobbleBorder/>` with a `seed` prop.

**The Filter Applies To The Edge Rule.** The displacement filter goes on the border element only, never on a container. Filtering an element that holds text drags the text through the same displacement and turns it to mush.

**The No Sketch On Fields Rule.** `.sketch` draws on a pseudo-element, and `<input>`, `<select>` and `<textarea>` cannot hold one – the outline silently never renders and the field is a white box on a white panel. Fields take a real 2px border instead (see Inputs).

## Components

### Buttons (platform)

- **Shape:** 12px radius, a 2px border in the fill's own deep tone, label type (Shantell 700, uppercase) at 0.76-0.95rem.
- **Sizes:** sm 36px tall, md 44px, lg 52px.
- **Solid (primary):** violet-deep fill, white text, violet-dark border; hover fills violet-dark. Teal and coral follow the same pattern (deep fill, dark rim) for go and danger; gold keeps its gold fill with navy text for the prize.
- **Outline:** transparent, navy text, violet border; hover fills violet-pale.
- **Ghost:** no border, navy-soft text; hover darkens the text and adds a 5% navy wash.
- **Pressed:** moves down 1px.
- **Disabled:** 70% opacity, line fill, line-strong border, `not-allowed`. A disabled control stays where it lives and says why beside it – it is never hidden.

### Buttons (staff console)

- **Shape:** 8px radius, 2px navy outline on every variant.
- **Primary:** sign blue (`#61cdf1`) on navy text, `0.5rem 1.1rem`. Hover deepens to `accent`.
- **Default:** white ground, navy text and outline. Hover fills mint.
- **Danger:** flame ground, white text.

### Focus

- **Platform:** a 3px magenta outline at 3px offset with a 6px radius, on every focusable element.
- **Staff console:** a 3px `accent` outline at 2px offset.

### Chips

- A pill of label type on a pale fill in its own tone: violet (tier), muted (theme, neutral facts), sky, teal, gold, coral.
- They name a fact about the thing they sit on. Two per header at most – a row of chips reads as clutter, and the rest of a project's facts sit in one quiet line of hand text beside them.

### Cards / Panels

- **Corner:** 16px, with the drawn border rather than a CSS one.
- **Background:** white for panels carrying forms, entries or feeds; cream at 60% for rail cards that sit in the chrome.
- **Padding:** `1.25rem 1.5rem` to `1.75rem`.
- **Never nested.** A panel inside a panel has no meaning in this system.

### Inputs / Fields

- **Style:** a real 2px `field` border, 12px radius, a barely-there 2% navy wash that turns white on focus. The border moves to `navy-soft` on hover and to violet on focus. Labels sit above in label type in violet-deep. `inputClass` and `borderedInputClass` in `ui.tsx` are this style.
- **Invalid:** a coral-deep border (`aria-invalid`).

### Navigation

- **Sidebar:** a cream nav card with a torn coral tab on its top edge. Items are Plus Jakarta at 1.02rem, divided by dashed `line` rules.
- **States:**
  - Current: extra-bold navy with a coral dot at the end.
  - Other items: semibold navy-soft.
  - Hover: navy.
- **Below lg:** a bottom tab bar of icon + label cells replaces the sidebar. The current cell is navy, the rest navy-soft.

### The checkpoint path (signature)

The platform's primary structure, and the thing the dashboard is. **All ten weeks render as one continuous track**, so a participant in week 2 can scroll down and see the music week, the displays and the breadboard computer waiting. The view lands on the current checkpoint on arrival.

A week opens with its setup (the gold questionnaire in week 1, the project form after), then the idea reel, then one node per journal entry with a progress reel wherever the logged hours cross each ten, then Submit. Week 1 is the exception: the idea reel is optional, so it sits side by side with the first devlog entry as a choice instead of gating it. Once the week's hours reach the submit floor, the trail forks: "Keep working" and "Submit project" sit side by side at 24% and 76% with an "or" between them.

- **Open:** sky face. The next open node gets a halo and a navy "Start here" callout that bobs above it.
- **Done:** teal face with a check. Hovering shows a mint bubble ("You've already completed this checkpoint!"), with a hand-text line saying what a click does now – edit the entry, post another reel, unsubmit.
- **Hand-in:** magenta face.
- **Setup:** gold, and it stays gold once done.
- **Locked:** sand face with a padlock, sunk to a 7px rim. Hovering shows a sand bubble naming the one thing in the way.
- **Passed:** teal-grey face, sunk to a 7px rim, for every node of a week whose Sunday has gone. Hovering says "This week has passed!". Only its Submit stays open.
- **Connectors:** 7px dots in `line-strong` at 45%, sampled along the sine, splitting straight into each arm of a fork.
- **Halfway:** a mint "Halfway! Now it's time to build" pill divides the design weeks from the build weeks. The trail ends on the printer the participant is saving for.

The three bubbles – navy callout, sand lock and mint done – are one shape: a 14px-radius drawn bubble with a pointer, hanging where the callout hangs. They never appear together on one node.

### The hanging sign (signature)

Page titles hang from two navy straps pinned above the content. On the platform the board is a torn painted plate in the page's own accent – orange for the shop, sky for Explore – so each destination is recognisable before a word of it is read. Used on every screen except the trail (which has the week banner) and the Doomscroller (where the reel is the page). `PageSign` in the platform, the `.hl-sign` pair in the staff console.

### The week banner (signature)

A band of torn painted paper in the week's colour, carrying "WEEK 1/10 · DESIGN" in label type and the headline in Plus Jakarta 800. The week's theme painting sits at its right, and a pill on the far right counts done over total. It pins to the top of the frame while that week's nodes flow beneath it and is then shoved off by the next one, which is what makes ten weeks read as a distance rather than a list.

### The Doomscroller (signature)

One reel at a time, snapping, laid out after the reel player people already know and drawn in the notebook's hand.

- **The reel** is a 16px card on navy with the lift shadow.
  - Project tag top-left, as on the rail's card.
  - Author, time and caption over a dark foot gradient.
  - A thin `teal-mid` progress bar along the bottom edge that seeks on click or drag.
- **The player strip** under the card, on the cream: drawn round play and mute buttons, the time in the hand face, an "Auto" switch in teal, and a speed pill. It drops auto and then speed as the column narrows, by container query.
- **The actions** hang beside the reel as drawn paper discs: author avatar, like (coral when on), comments (violet when open), views. Drawn round up/down buttons sit above them when the column is tall enough. On a phone the discs drop away and white icons sit over the picture.
- **Motion:** one flick glides one reel (360ms, quartic ease-out). A double tap stamps a coral heart that pops and floats off where it landed.
- **The side-rail feed** is the same card at rail size, in a cream panel titled in label type.

## Do's and Don'ts

### Do:

- **Do** pick the world first. A platform screen uses the platform palette, Plus Jakarta, drawn edges and 16px panels; a landing section uses ink, Ubuntu, Open Sans and square plates.
- **Do** draw platform borders with `.sketch` / `.sketch-2` / `.sketch-3` and vary them between neighbouring panels.
- **Do** keep a disabled control in place and say why next to it; never hide a control because it can't be used right now.
- **Do** let a puck's colour say its state, and say the rest in the bubble that hangs above it.
- **Do** give every focusable surface the ring: magenta, 3px, 3px offset on the platform; accent, 3px, 2px offset in the staff console.
- **Do** keep one size per text role on a screen: asides 0.84rem, body 0.9rem, timeline titles 0.95rem.
- **Do** put the content first when the platform collapses; below lg the chrome moves to a header and a bottom tab bar.

### Don't:

- **Don't** mix the two palettes, or put a platform component on a landing page.
- **Don't** shadow a panel, card, button or field. Shadows belong to things sitting on the paper – pucks, stickers, tape, reels.
- **Don't** set text a participant must read in `line-strong`, `teal`, `gold-deep`, `orange-deep`, `coral` or `sky-deep` on cream, or white on `sky`, `teal`, `orange` or `teal-grey` – all below 4.5:1 (see Measured contrast).
- **Don't** put `.sketch` on an `<input>`, `<select>` or `<textarea>`; it cannot render there.
- **Don't** trust `--color-hl-yellow*`: those variables hold blues.
- **Don't** set Masterpiece in bold, or use it for anything but the wordmark.
- **Don't** apply the wobble filter to anything containing text.
- **Don't** nest panels, and don't reach for a panel when the content is a path, a feed or a form.
- **Don't** stack chips as a page's structure; a fact that needs no emphasis goes in the quiet hand-text line.
- **Don't** use a Unicode glyph as an icon. Icons are drawn SVG on a 24px grid at a 1.8px round stroke.
