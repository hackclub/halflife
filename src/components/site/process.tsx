import type { CSSProperties } from "react";

import Image from "next/image";

import gatoandspirit from "../../../public/art/extras/gatoandspirit.png";
import gatohead from "../../../public/art/extras/gatohead.png";
import gatointube from "../../../public/art/extras/gatointube.png";
import gatoycaja from "../../../public/art/extras/gatoycaja.png";
import hammer from "../../../public/art/extras/hammer.png";
import spiritguy from "../../../public/art/extras/spiritguy.png";
// Parked: the corner decals, to be placed later.
// import CornerDecal, { type DecalName } from "@/components/site/corner-decal";
import ImageSlot from "@/components/site/image-slot";
import type { Step } from "@/lib/site/content";
import { ASIDES, DESIGN_WEEKS, STEPS } from "@/lib/site/content";
import {
  COMP_WIDTH,
  STACK_VIEW,
  at,
  box,
  plate,
  plateBox,
  stackWeld,
  u,
  weld,
} from "@/lib/site/stage";

/**
 * The header plate — "how does it work?".
 *
 * It used to live in the hero, in a `.stage` of its own that inherited the
 * default 1728 cap while this one caps at `STAGE_CAP`. Both are `cqw`, so one
 * comp unit was a different number of pixels in each, and the band that drops
 * out of the header had to cross between them: it reached 179 of its own units
 * below the hero's block while its landing plate had moved to 112px below the
 * top of this one. Under about 1333px of viewport the arithmetic happened to
 * clear. Above it the band ran through "spend 5 weeks designing 5 projects",
 * in the plates' own colour, over the top of it — one drawing in two grids.
 *
 * The header is a part of this drawing, so it is a plate in this stage now, on
 * one grid at one cap with the four plates it introduces. Its `918` is the
 * comp's own, which is also the proportion the comp drew: narrower than step
 * 1's 975, where uncapped it had grown to 1.38x the plate it introduces.
 *
 * It also puts the section's own heading inside the section the skip link
 * targets, which it was not before.
 */
const HEADER_LEAD = 96;
const HEADER = plate(474, HEADER_LEAD, 918, 201);

/**
 * The header's weld — comp node 275:181, and the first of the page's four.
 *
 * Its run and its two overlaps are named here rather than inside `WELDS`
 * because `SHIFT` is derived from them: the room the header needs above step 1
 * is the header's own height plus this band's run, less the ends it buries in
 * each. Change the run and the programme moves to suit it.
 */
const LEAD_WELD = { run: 106, rise: 6, drop: 15, mean: 70.6 } as const;

/**
 * How much step 1 grew when its heading came back, and therefore how far
 * everything under it moved.
 *
 * `allweeks.png` had been given the whole plate, which left nowhere for the
 * step's own title to sit: its ink reaches all four edges, and the only band
 * of bare canvas in the file — the top-left corner, 239 x 223 comp units once
 * the picture is drawn at 975 — is a third of what a 40-unit line needs. The
 * choice was to shrink the picture into the leftover or to lengthen the plate,
 * and shrinking loses more than it saves: the week marks are drawn small, so
 * at the 743 units a title would leave them the "WEEK n" caps land at 8px.
 *
 * So the plate grew instead, which is what the steps below it already did when
 * their pictures did not fit the comp's slots. Growing upward was not
 * available: the header's weld lands 15 units inside the plate's top edge, so
 * that edge is pinned. Everything below moves down by this instead — steps
 * 2-4, both asides, and the five extras that sit beside them — and the three
 * welds between them now follow the plates rather than being re-counted.
 */
const STEP_ONE_GROWTH = 105;

/**
 * How far the programme moved down when the header joined it.
 *
 * Step 1 used to start at 164 with the header in someone else's grid. It now
 * starts wherever the header's weld lands, so this is derived rather than
 * counted — nothing below can fall out of step with the header's height. It
 * comes to 218, and every plate, aside and extra below carries it, so every
 * clearance measured in here is still the number it was.
 */
const SHIFT =
  HEADER.y +
  HEADER.h -
  LEAD_WELD.rise +
  LEAD_WELD.run -
  LEAD_WELD.drop -
  (59 + STEP_ONE_GROWTH);

/**
 * The plates, and the only place their geometry is written.
 *
 * Every number is the comp's own, and the two offsets that have moved the
 * programme are added here rather than folded into the literals: `STEP_ONE_GROWTH`
 * for the 105 units step 1 grew to hold its heading, which its own height
 * takes and the three below it take as a shift, and `SHIFT` for the room the
 * header and its weld now need above all four. Both were counted into these
 * numbers by hand before, which is why the record of them lived in prose.
 */
const PLATES = {
  header: HEADER,
  design: plate(57, 59 + STEP_ONE_GROWTH + SHIFT, 975, 547 + STEP_ONE_GROWTH),
  funding: plate(812, 836 + STEP_ONE_GROWTH + SHIFT, 823, 445),
  build: plate(57, 1406 + STEP_ONE_GROWTH + SHIFT, 958, 582),
  printer: plate(731, 2143 + STEP_ONE_GROWTH + SHIFT, 943, 458),
} as const;

/**
 * The welds, derived from the plates they join.
 *
 * These were four sets of absolute centreline midpoints, which is to say four
 * hand-kept copies of where the plates are. A plate could move — step 1 has,
 * twice, for its heading and for its artwork — and its bands would not, so the
 * page's joints were only ever as correct as the last time someone re-added
 * the offset to all of them. `weld` takes the plates instead: `at` is how far
 * across that plate's own edge the end sits, and `rise`/`drop` are how deep it
 * reaches inside. Every number is still the comp's, written as the offset it
 * measures over the width it measures across.
 *
 *   275:181  header      ->  step 1 top-right
 *   275:132  step 1 bottom-right  ->  step 2 top-left
 *   275:133  step 2 bottom-left   ->  step 3 top-right
 *   275:148  step 3 bottom-right  ->  step 4 top-left
 */
const WELDS = [
  {
    id: "how-to-one",
    exit: {
      plate: PLATES.header,
      at: 383.5 / PLATES.header.w,
      rise: LEAD_WELD.rise,
    },
    entry: {
      plate: PLATES.design,
      at: 763.75 / PLATES.design.w,
      drop: LEAD_WELD.drop,
    },
    mean: LEAD_WELD.mean,
  },
  {
    id: "one-to-two",
    exit: { plate: PLATES.design, at: 778.25 / PLATES.design.w, rise: 16.5 },
    entry: { plate: PLATES.funding, at: 155.25 / PLATES.funding.w, drop: 12.5 },
    mean: 92.2,
  },
  {
    id: "two-to-three",
    exit: { plate: PLATES.funding, at: 148.5 / PLATES.funding.w, rise: 28.5 },
    entry: { plate: PLATES.build, at: 803 / PLATES.build.w, drop: 26.5 },
    mean: 102.2,
  },
  {
    id: "three-to-four",
    exit: { plate: PLATES.build, at: 693.25 / PLATES.build.w, rise: 6.5 },
    entry: { plate: PLATES.printer, at: 178.5 / PLATES.printer.w, drop: 22 },
    mean: 120.3,
  },
] as const;

/**
 * Which corner each plate's decal goes in — PARKED, not yet applied.
 *
 * The placements below are commented out at their sites. This is the analysis
 * they were derived from, kept so it does not have to be redone: the corner
 * clearances, the one plate with only a single legal corner, and the reason
 * the decals have to print under the content rather than over it.
 *
 * The rule is that a decal sits on a plate and never on a joint, so the
 * choice is made against the bands rather than by taste. Measuring each
 * corner's distance to the nearest band, at the y where that band actually
 * crosses the plate's edge, rules three of them out: step 2's top-left (72
 * comp units of clearance) and bottom-left (83), and step 4's top-left (66).
 * A decal's ink runs 12% of its plate — 99 units on step 2, 113 on step 4 —
 * so all three would land on the weld. Step 3's top-right is tight too, at
 * 72, and moot: the set has no top-right decal to put there.
 *
 * That leaves step 2 with exactly one corner, bottom-right, and step 4 with
 * two. Everything else is clear by 130 units or more, and the asides are
 * clear on all four — no band comes within 200 units of either.
 *
 * Given those constraints the order is chosen so no two marks down the
 * section repeat and no two land on the same corner:
 *
 *   header plate   top-left        (in Hero, with the plate)
 *   step 1         bottom-left     the band leaves the opposite corner
 *   step 2         bottom-right    forced — both left corners are welds
 *   step 3         top-left 2
 *   aside, viral   bottom-right 2
 *   step 4         bottom-left     its top-left is under the last band
 *   aside, community  top-left
 *
 * Both layouts carry the same seven, so the stacked page is the same drawing
 * and not a reduction of it. The flow layout's own welds are siblings rather
 * than overlays, so nothing is ruled out down there — the assignment is the
 * stage's, kept for consistency rather than recomputed.
 *
 * The other constraint, and the one that decided the treatment: these plates
 * are full, so text overprints a decal wherever one is big enough to read.
 * Measured against the darkest opaque pixel in the set, rgb(63,73,38), AA
 * holds up to 0.55 opacity for ink on lavender-pale and only 0.30 for the
 * asides' indigo on lavender — so 0.30 is what `corner-decal.tsx` prints at,
 * and the decals sit under the content, not over it. Shrinking them instead
 * does not work: the decal is a share of the plate's width while the flow
 * layout's padding is a flat 20px, so anything visible crosses it anyway.
 */
/**
 * How wide a step's artwork is actually painted.
 *
 * These files run 8439 to 11876 across and the widest any is ever drawn is
 * 503px, so an undeclared `sizes` would pull a candidate ten times the box.
 * Stage: 736 comp units at the 1180 cap is 502.6px. Stacked: the plate runs
 * the full `max-w-2xl` column, the same 608px the lead week pairing gets.
 */
const HOW_LABEL = "how does it work?";

const STEP_ART_SIZES = {
  stage: "510px",
  /** Step 1's picture runs its plate's full 975 units, 666px at the 1180 cap. */
  weeks: "670px",
  stacked: "(min-width: 640px) 610px, 100vw",
} as const;

/**
 * The width the composition stops scaling at — and with it, the one number
 * that decides this section's height.
 *
 * Everything in the stage is a comp pixel expressed in `cqw`, so every length
 * in here is a share of the stage's own width. That includes the height: 2706
 * comp units is 156.60cqw, which means widening the window made the section
 * taller, 1:1.57. From 1180 to 1728 that added 858px of scroll — a page
 * getting longer as it gets more room, which is backwards.
 *
 * `.stage` caps at 1728, so the section was constant above that and variable
 * below it; the whole problem lived in the one band between the breakpoint and
 * the cap. Capping here at the breakpoint itself removes the band: the stage is
 * 1180 wide at 1180 and 1180 wide at 3840, so the height is a flat 1848px at
 * every width this layout is ever shown at — which it now actually is; see the
 * stage element below for the `cqw` fallback that was defeating this cap.
 *
 * Nothing is smaller than it already was, which is the part worth being clear
 * about: 1180 was always the narrowest this layout renders at, so the type now
 * sits everywhere at the size a 1180 screen has always shown it — the week
 * labels at 13.7px, the step titles at 27.3px. The composition simply stops
 * growing rather than shrinking. The section's ground and its wave stay
 * full-bleed; only the plates are held to a centred column.
 *
 * Raising this trades exactness for scale. Any value above 1180 re-opens a
 * band between the two where the height moves again — 1280 gives 16px week
 * labels and 151px of travel, 1400 gives 16.2px and 331px.
 */
const STAGE_CAP = 1180;

/**
 * The bottom edge of the lowest plate, so the stage is exactly its own content
 * and nothing more. Read off `PLATES` rather than restated: it was a literal
 * that had already been re-counted twice by hand as the artwork moved things.
 */
const STAGE_H = PLATES.printer.y + PLATES.printer.h;

/**
 * A step's artwork: the picture where there is one, the drawn footprint where
 * there is not — the same optional-path-with-slot-fallback the week backdrops
 * and the carousel cards already use.
 *
 * Unlike a week backdrop this is a picture on show rather than a ground, so
 * nothing is screened, blended or thrown away: the comp's boxes were refitted
 * to the artwork's own proportions instead. `getfunding.png` is 3.133:1 into a
 * slot the comp drew at 4.748:1, `build.png` is 2.242:1 into one drawn at
 * 2.736:1, and `prizes.png` is 2.863:1 into that same 2.736:1 — so every box
 * took its picture's shape and the plates below moved to make room. Step 4 is
 * the only one that moved *up*: its picture is wider than the slot the comp
 * drew, so the plate lost 12 units rather than gaining them, and being the
 * last plate it took the section's height down with it.
 *
 * `cover` rather than `contain` after all that, and only because the refitted
 * boxes are whole comp units: 736x235 is 3.1319:1 against the file's 3.1333:1.
 * Cover answers that 0.05% with 0.05% of the picture; contain would answer it
 * with a hairline of bare plate down one edge, which is the visible one.
 */
function StepArt({
  step,
  className = "",
  style,
  scale,
  sizes,
}: {
  step: Step;
  className?: string;
  style?: CSSProperties;
  /** Only reaches the drawn fallback; a photograph has no fittings to scale. */
  scale?: number;
  sizes: string;
}) {
  if (!step.slot) return null;

  if (!step.art) {
    return (
      <ImageSlot
        label={step.slot.label}
        ratio={step.slot.ratio}
        className={className}
        style={style}
        scale={scale}
      />
    );
  }

  return (
    <div
      className={`overflow-hidden ${className}`}
      // `position` lives in `style` for the same reason it does on ImageSlot
      // and the week backdrops: the stage passes `absolute` here, where it has
      // to be able to beat the component's own `relative`.
      style={{ position: "relative", ...style }}
    >
      {/* Decorative: each of these sits directly under the heading that says
          what the step is, and the drawn slot it replaces carried only its own
          footprint label. If either picture turns out to carry information the
          heading does not — an order-flow diagram would — it wants real alt
          text rather than this. */}
      <Image
        src={step.art}
        alt=""
        fill
        sizes={sizes}
        quality={90}
        className="object-cover"
      />
    </div>
  );
}

/**
 * Loose artwork in the air around the programme.
 *
 * Every box here is placed against the comp grid the plates are on, in the gaps
 * they leave: right of step 1, left of step 2, either side of the belt of
 * asides, and left of step 4. The hammer is the one with a brief — it sits 105
 * to the right of "then spend 5 weeks building your projects!", overlapping its
 * lower half by 156, so it reads as belonging to that step rather than floating
 * between two.
 *
 * Nothing here is eyeballed. Each box clears every plate, aside and weld by
 * at least 38 comp units, which is why the sizes are not round numbers:
 * width is chosen for the pocket and height is the artwork's own ratio, so a
 * picture is never squeezed to fit a gap.
 *
 * The files were trimmed to their ink first. They arrived as 3000-squares
 * filling 33-74% of their canvas, and an untrimmed square would have reserved a
 * box of transparent air that collided with things the picture never reached.
 *
 * Stage only. Below 1180 the layout is a single column of plates with no gaps
 * to put anything in, and scattering art down its margins would be decoration
 * competing with the one thing a phone has room for.
 *
 * Their y is the comp's own; `SHIFT` is added where they are drawn, with
 * everything else that sits below the header.
 *
 * The five below step 1 carry `STEP_ONE_GROWTH` on their y, which is what
 * keeps those clearances the numbers they were: the hammer still sits 105 to
 * the right of step 3 and overlaps its lower half by 156, and the tightest of
 * the six is still gatohead's 38 under step 3. Only gatoandspirit stays put —
 * it is beside step 1 rather than below it, clear of the taller plate by 258
 * across, and the plate grew downward.
 */
const EXTRAS = [
  { src: gatoandspirit, x: 1290, y: 300, w: 300, h: 255 },
  { src: spiritguy, x: 120, y: 955, w: 190 / 2, h: 293 / 2 },
  { src: gatointube, x: 400, y: 1155, w: 230, h: 272 },
  { src: gatoycaja, x: 1180, y: 1425, w: 170, h: 172 },
  { src: hammer, x: 1120, y: 1937, w: 310, h: 271 },
  { src: gatohead, x: 180, y: 2131, w: 230, h: 198 },
] as const;

/** The widest of them is 310 comp units, 212px at the 1180 cap. */
const EXTRA_SIZES = "220px";

/**
 * The five design weeks, for anything that cannot see the picture.
 *
 * `allweeks.png` carries the subjects and their week numbers as drawing, so
 * this is where that content still lives as text — for a screen reader, for
 * find-in-page, and for anything indexing the page. It is the same
 * `DESIGN_WEEKS` the five pairings were built from, so the two cannot drift.
 */
function WeekList() {
  return (
    <ul className="sr-only">
      {[DESIGN_WEEKS.lead, ...DESIGN_WEEKS.rest].map((week) => (
        <li key={week.subject}>{`${week.week}: ${week.subject}`}</li>
      ))}
    </ul>
  );
}

export default function Process() {
  const [design, funding, build, printer] = STEPS;
  const [viral, community] = ASIDES;

  return (
    <section
      id="how-it-works"
      aria-label="How Half Life works"
      className="relative z-0 isolate min-[1180px]:pb-[10vh]"
    >
      {/* ── Comp reproduction, 1180px and up ───────────────────────────── */}
      {/* Every child here is absolutely positioned, so the stage has no
          intrinsic height and has to be told one — as a ratio of its own
          width, never as a `cqw` length.

          `height: u(2474)` looked equivalent and was not. A container query
          unit resolves against the nearest *ancestor* container, and an element
          is never its own: `.stage` is the container here, so its own `cqw`
          height found no eligible ancestor and fell back to the viewport, the
          spec's last resort. The children, being descendants, did resolve
          against `.stage` and stopped at its 1180 cap. So the content ended at
          a flat 1689px while the box claimed 143.17vw, and every pixel past the
          cap became dead air under step 4 — 372 at 1440, 1060 at 1920, 1976 at
          2560, growing without limit. (Those are the numbers as they stood;
          `STAGE_H` has moved twice since, with the artwork.)

          `aspect-ratio` is self-referential by definition and needs no
          container, which is why this is written as a ratio and not a length.
          Height is now `STAGE_H`/1728 of the used width at every
          size, so it is the flat pixel count the cap was introduced to
          deliver.

          The trailing air below it is the section's `pb-[10vh]`. Viewport
          height, not the comp grid: this gap is the beat between two sections
          and what makes it feel long or short is how much screen is left to
          look at, not how wide the window is. */}
      <div
        className="stage hidden min-[1180px]:block"
        style={{
          maxWidth: STAGE_CAP,
          aspectRatio: `${COMP_WIDTH} / ${STAGE_H}`,
        }}
      >
        {/* The section's own heading, and the plate the first weld leaves.
            First in the stage because it reads first; nothing else is drawn
            in the 297 units it occupies, so it has no paint order to lose.

            `grid place-items-center` rather than the comp's own offset: the
            line is a label for the plate, so it is centred by the box and
            stays centred if the copy changes. */}
        <h2
          className="absolute grid place-items-center rounded-xl bg-hl-lavender-pale"
          style={plateBox(PLATES.header)}
        >
          <span
            className="whitespace-nowrap font-display font-bold text-hl-ink"
            style={{
              // The comp's own 100, which is now 68px at every width this
              // layout runs at — the same trade `STAGE_CAP` already makes for
              // the four step titles below, and the size a 1180 screen has
              // always shown this line at.
              fontSize: u(100),
              lineHeight: 1,
              letterSpacing: "-0.03em",
            }}
          >
            {HOW_LABEL}
          </span>
          {/* Parked: corner decals, to be placed later. <CornerDecal decal="topLeft" /> */}
        </h2>

        {/* Decorative, and drawn before the plates so that if a plate is ever
            resized past one of them the plate wins the overlap. */}
        {EXTRAS.map((extra) => (
          <div
            key={extra.src.src}
            aria-hidden
            className="absolute"
            style={box(extra.x, extra.y + SHIFT, extra.w, extra.h)}
          >
            <Image
              src={extra.src}
              alt=""
              fill
              sizes={EXTRA_SIZES}
              quality={90}
              className="object-contain"
            />
          </div>
        ))}

        {/* Step 1 — design weeks: a title over one piece of artwork.

            `allweeks.png` is 1920x1080 and gets 975x548 here, 1.7778 against
            1.7792 — a 0.08% match, which is why it is still `cover`. The five
            hand-placed pairings, their five screened backdrops and the comp's
            own week marks are all inside it.

            The picture had the whole plate for a while and the title was
            sr-only, and that is the one thing that made this step read as a
            different object from the three below it: they say what you do and
            then show it, and this one only showed. The plate is
            `STEP_ONE_GROWTH` taller so the title can sit where theirs do — top
            of the plate, 40 units, on the plate's own ground — and the picture
            keeps every unit of width it had.

            The title is centred where the other three are ranged left, and
            that is the picture's doing rather than a whim: the five pairings
            are hand-placed across the full 975 with no left edge to range
            against, so a left-ranged line would hang off a composition that
            has no margin. The box is still the family's 68 gutter, taken on
            both sides — 68 + 839/2 lands on 487.5, the plate's own centre — so
            the line is centred by the box rather than by an offset that has to
            be re-derived if the copy changes. 38 from the top is step 2's.

            The picture starts at 92 instead of the family's ~109 because it
            brings 30 units of its own transparent margin with it, so first ink
            lands 40 below the title either way.

            The five weeks stay in the document under it. A picture that
            replaces text has to hand that text back or the page has quietly
            lost it, and `WeekList` carries the subjects and their numbers. */}
        <div
          className="absolute overflow-hidden rounded-xl bg-hl-lavender-pale text-hl-ink"
          style={plateBox(PLATES.design)}
        >
          <h3
            className="absolute text-center font-display font-bold text-balance"
            style={{
              ...at(68, 38),
              width: u(839),
              fontSize: u(40),
              lineHeight: 1.1,
            }}
          >
            {design.title}
          </h3>
          {design.art ? (
            <div className="absolute" style={box(0, 92, 975, 548)}>
              <Image
                src={design.art}
                alt=""
                fill
                sizes={STEP_ART_SIZES.weeks}
                quality={90}
                className="object-cover"
              />
            </div>
          ) : null}
          <WeekList />
          {/* Parked: corner decals, to be placed later. <CornerDecal decal="bottomLeft" over /> */}
        </div>

        {/* Step 2 — funding */}
        <div
          className="absolute rounded-xl bg-hl-lavender-pale text-hl-ink"
          style={plateBox(PLATES.funding)}
        >
          <h3
            className="absolute font-display font-bold"
            style={{
              ...at(94, 38),
              width: u(690),
              fontSize: u(40),
              lineHeight: 1.1,
            }}
          >
            {funding.title}
          </h3>
          <StepArt
            step={funding}
            style={{ ...box(53, 109, 736, 235), position: "absolute" }}
            scale={1.05}
            sizes={STEP_ART_SIZES.stage}
          />
          <p
            className="absolute whitespace-nowrap font-semibold opacity-60"
            style={{ ...at(323, 353), fontSize: u(20), lineHeight: 1 }}
          >
            {funding.caption}
          </p>
          {/* Bottom-right is the only corner free of a band here. */}
          {/* Parked: corner decals, to be placed later. <CornerDecal decal="bottomRight" /> */}
        </div>

        {/* Step 3 — build */}
        <div
          className="absolute rounded-xl bg-hl-lavender-pale text-hl-ink"
          style={plateBox(PLATES.build)}
        >
          <h3
            className="absolute font-display font-bold"
            style={{
              ...at(68, 42),
              width: u(821),
              fontSize: u(40),
              lineHeight: 1.1,
            }}
          >
            {build.title}
          </h3>
          <StepArt
            step={build}
            style={{ ...box(111, 158, 736, 328), position: "absolute" }}
            scale={1.35}
            sizes={STEP_ART_SIZES.stage}
          />
          {/* Parked: corner decals, to be placed later. <CornerDecal decal="topLeft2" /> */}
        </div>

        {/* Step 4 — the printer */}
        <div
          className="absolute rounded-xl bg-hl-lavender-pale text-hl-ink"
          style={plateBox(PLATES.printer)}
        >
          <h3
            className="absolute font-display font-bold"
            style={{
              ...at(69, 52),
              width: u(700),
              fontSize: u(40),
              lineHeight: 1.1,
            }}
          >
            {printer.title}
          </h3>
          <StepArt
            step={printer}
            style={{ ...box(106, 140, 736, 257), position: "absolute" }}
            scale={1.35}
            sizes={STEP_ART_SIZES.stage}
          />
          {/* Parked: corner decals, to be placed later. <CornerDecal decal="bottomLeft" /> */}
        </div>

        {/* Asides — small plates orbiting the band. Only where they sit
            differs; the plate itself is the same object twice. */}
        <Aside aside={viral} origin={[1114, 1636 + SHIFT]} />
        <Aside aside={community} origin={[59, 2367 + SHIFT]} />

        {/* The welds, drawn last so they ride over the plates they join */}
        {WELDS.map((w) => {
          const b = weld(w.exit, w.entry, w.mean);
          return (
            <svg
              key={w.id}
              className="absolute"
              style={box(b.x, b.y, b.w, b.h)}
              viewBox={`0 0 ${b.w} ${b.h}`}
              preserveAspectRatio="none"
              fill="none"
              aria-hidden
            >
              {/* The bands are the plates' own material, not a rule drawn
                  between them — they ride over the plates they join, so a band
                  in any other colour reads as a weld in a second metal. */}
              <path d={b.d} fill="var(--color-hl-lavender-pale)" />
            </svg>
          );
        })}
      </div>

      {/* ── Stacked layout, below 1180px ───────────────────────────────── */}
      {/* `pt-8` on a phone, where the hero above is content-sized and ends on
          its scroll cue: the full 80 on top of the cue's own room read as the
          two sections having nothing to do with each other. */}
      <div className="px-4 pt-8 pb-24 sm:px-8 sm:pt-20 min-[1180px]:hidden">
        <div className="mx-auto flex max-w-2xl flex-col">
          {/* The header, and the weld that leaves it — the same two objects
              the stage opens with, and for the same reason: this is where the
              drawing starts, so this is where the line starts.

              `w-fit` is load-bearing. The plate is as wide as its own line
              rather than the column, so the weld below it is offset by a share
              of *the plate* — `StackWeld`'s `anchor` — and cannot wander off the
              edge of it as the copy or the type size changes. The plate keeps
              its left rank; the four below it are full-width, which is what
              makes this one read as their heading rather than as a fifth
              step. */}
          <div className="flex w-fit flex-col">
            <h2
              className="rounded-xl bg-hl-lavender-pale px-5 py-3 font-display font-bold text-balance text-hl-ink sm:px-8 sm:py-4"
              style={{
                // Both ends of this clamp are measured, not chosen. The line is
                // 7.71em wide in Urbanist bold — the comp's own 100 ran it to
                // 84% of a 918 plate — so its size and the width it needs are
                // the same number, and the plate is that plus its padding.
                //
                // The floor was 1.75rem, held down by Masterpiece, which set
                // this line wide enough to push past a 320px viewport. That
                // left the section's heading at 28px over 24px step titles —
                // 1.17x, where the stage runs 2.50x, so the thing introducing
                // the programme read as another item in it. At 2.25rem it is
                // 1.50x and still one line from 360px up; at 320 it takes two,
                // which a heading plate can carry and `text-balance` splits.
                //
                // The ceiling was 3.25rem, which capped this at 52px right up
                // to 1179px — and then the stage took over at 68.3px, a 31%
                // jump at a breakpoint that is supposed to be a change of
                // layout, not of scale. 4.25rem is 68px, so the two layouts now
                // hand the line over at the same size, and the widest plate it
                // makes is 556px inside a 672px column.
                fontSize: "clamp(2.25rem, 9vw, 4.25rem)",
                letterSpacing: "-0.03em",
                lineHeight: 1.05,
              }}
            >
              {HOW_LABEL}
            </h2>
            <StackWeld lean="right" anchor />
          </div>

          <ol className="flex flex-col">
            <li>
              <Plate>
                {/* Centred here for the same reason as on the stage: the
                  picture below runs the plate's full width and places its five
                  pairings across all of it, so the title belongs over the
                  middle of it rather than ranged against an edge the drawing
                  does not have. Steps 2-4 keep their left rank — their
                  pictures are single objects sitting inside the plate. */}
                <h3 className="text-center font-display text-2xl font-bold text-balance sm:text-3xl">
                  {design.title}
                </h3>
                {design.art ? (
                  <div className="relative mt-6 aspect-[1920/1080] w-full overflow-hidden">
                    <Image
                      src={design.art}
                      alt=""
                      fill
                      sizes={STEP_ART_SIZES.stacked}
                      quality={90}
                      className="object-cover"
                    />
                  </div>
                ) : null}
                <WeekList />
              </Plate>
            </li>

            <StackWeld lean="left" />

            <li>
              <Plate>
                <h3 className="font-display text-2xl font-bold sm:text-3xl">
                  {funding.title}
                </h3>
                <StepArt
                  step={funding}
                  className="mt-6 aspect-[11876/3790] w-full"
                  sizes={STEP_ART_SIZES.stacked}
                />
                <p className="mt-4 font-semibold text-opacity-40">{funding.caption}</p>
              </Plate>
            </li>

            <StackWeld lean="right" />

            <li>
              <Plate>
                <h3 className="font-display text-2xl font-bold sm:text-3xl">
                  {build.title}
                </h3>
                <StepArt
                  step={build}
                  className="mt-6 aspect-[9673/4315] w-full"
                  sizes={STEP_ART_SIZES.stacked}
                />
              </Plate>
            </li>

            <StackWeld lean="left" />

            <li>
              <Plate>
                <h3 className="font-display text-2xl font-bold sm:text-3xl">
                  {printer.title}
                </h3>
                <StepArt
                  step={printer}
                  className="mt-6 aspect-[8439/2948] w-full"
                  sizes={STEP_ART_SIZES.stacked}
                />
              </Plate>
            </li>
          </ol>

          {/* The asides, after the line rather than inside it.

              `viral` used to sit between steps 3 and 4, which left the third
              weld running from *it* into step 4 — the one place either layout
              said an aside was part of the programme. On the stage they orbit
              the line and no weld touches them; down here they follow it. */}
          {/* `gap-8` against the plates' own `py-7`: two plates of the same
              colour separated by less than their own padding read as one
              object with a seam. 32 outside, 28 inside. The `pt-10` above the
              pair is the generous break that takes them off the line. */}
          <div className="flex flex-col gap-8 pt-10">
            <Aside aside={viral} stacked />
            <Aside aside={community} stacked />
          </div>
        </div>
      </div>
    </section>
  );
}

function Plate({ children }: { children: React.ReactNode }) {
  return (
    // Parked, with the decals. Bringing them back needs `relative isolate`
    // here and a `decal` prop threaded in: the decal is absolutely positioned
    // at `z-index: -1`, so it needs this plate both as its containing block
    // and as the stacking context that keeps it from escaping behind it. Step
    // 1's plate is a full-bleed picture and takes `over` instead. The stage
    // plates are absolute already, so they are containing blocks already.
    <div className="rounded-xl bg-hl-lavender-pale px-5 py-7 text-hl-ink sm:px-8 sm:py-9">
      {children}
      {/* Parked: corner decals, to be placed later. <CornerDecal decal={decal} /> */}
    </div>
  );
}

/**
 * The stacked layout's weld.
 *
 * Both paths were hardcoded — the one thing in either layout that really was
 * a drawn shape rather than a derived one — and the left-leaning one missed
 * its own anchor pair by 5 units, so the zigzag jogged sideways at every
 * second plate. `stackWeld` builds both from the stage's `BAND_TAPER` and one
 * anchor pair, taken in whichever order the band leans, so one weld's exit is
 * the last one's entry and the line down the column is continuous.
 *
 * The fill was `--color-hl-cyan`, left over from before the stage's bands
 * became the plates' own material. A weld in a second metal is exactly what
 * DESIGN.md rules out, and it is the same drift as the `#EDEDED` the hero's
 * band used to carry: `lavender-pale` is what the plates either side of it
 * are, so the band reads as the material running on between them.
 *
 * The box is wider than it is tall by the same ratio at both sizes, which puts
 * the run at 51-53° — inside the 49-71° the stage's four bands sit at, and the
 * reason the ends are near the middle of the column rather than at its edges:
 * a 672px column joined edge to edge across a 64px gap would lie almost flat
 * and read as a shelf rather than as a joint.
 */
function StackWeld({
  lean,
  anchor = false,
}: {
  lean: "left" | "right";
  /**
   * Leave the *parent's* own width at the stage's own 383.5/918 instead of
   * centring in the column — for the header plate, which is only as wide as
   * its line. Also renders a `div` rather than an `li`, since that weld sits
   * above the list rather than inside it.
   */
  anchor?: boolean;
}) {
  const Tag = anchor ? "div" : "li";
  return (
    <Tag
      role="presentation"
      aria-hidden
      className={anchor ? "flex" : "flex justify-center"}
    >
      <svg
        viewBox={`0 0 ${STACK_VIEW.w} ${STACK_VIEW.h}`}
        preserveAspectRatio="none"
        fill="none"
        className={`h-16 w-40 sm:h-24 sm:w-56${
          // 41.78% is the fraction of its plate the stage's own header weld
          // leaves at, so the margin puts this box's left edge there and the
          // translate walks it back by the 35% of its own width that the run's
          // exit sits at — landing the exit itself on 41.78%.
          //
          // The translate is what makes this one pair of values rather than one
          // per breakpoint: it is a share of whatever width the box currently
          // has, so `w-40` and `sm:w-56` both come out anchored with nothing to
          // keep in step. The `calc()` this replaces needed the box's width
          // spelled out, and Tailwind generated the base rule but not the `sm:`
          // one, so the weld would have jumped off the plate at 640px.
          anchor ? " ml-[41.78%] -translate-x-[35%]" : ""
        }`}
      >
        <path d={stackWeld(lean)} fill="var(--color-hl-lavender-pale)" />
      </svg>
    </Tag>
  );
}

/**
 * The aside plate.
 *
 * Its two pieces used to be absolute boxes at fixed y inside the plate, which
 * is what made the spacing read as an accident: the title's height depends on
 * whether it wraps, but the body's top did not move with it. "earn more prizes
 * by going viral!" takes two lines and left a 5-unit gap; "100,000 more of you"
 * takes one and left 39. The plate's own padding was uneven too — 33 over the
 * title, 43 under the body — and the body box sat 21.4 from the left against
 * 19.7 from the right, so it was a fraction off centre.
 *
 * It is a flow box now: one padding value on each axis, one gap, and the title
 * and body both centred, so the two plates space themselves identically
 * whatever their copy does. The comp's own type sizes are kept; only the
 * spacing is re-derived.
 */
const ASIDE = {
  /** The comp's plate. Height is a floor, not a fixed size, so a title that
   *  wraps lengthens the plate instead of crushing the gap below it. */
  w: 555,
  minH: 261.227,
  padX: 34,
  padY: 30,
  gap: 18,
  titleSize: 30.833,
  bodySize: 22.269,
} as const;

/**
 * Stacked takes no origin and the stage plate cannot do without one, so the
 * two are separate shapes rather than one with everything optional.
 */
type AsideProps = { aside: (typeof ASIDES)[number] } & (
  | { stacked: true; origin?: never }
  /** Where the plate sits on the stage, in comp pixels. */
  | { stacked?: false; origin: readonly [number, number] }
);

function Aside(props: AsideProps) {
  const { aside } = props;

  if (props.stacked) {
    return (
      <div className="rounded-xl bg-hl-lavender px-5 py-7 text-center text-hl-indigo sm:px-7">
        <h3 className="font-display text-xl font-bold sm:text-2xl">
          {aside.title}
        </h3>
        <p className="mt-4 text-[0.975rem] leading-relaxed sm:text-base">
          {aside.body}
        </p>
        {/* Parked: corner decals, to be placed later. <CornerDecal decal={decal} /> */}
      </div>
    );
  }

  return (
    <div
      className="absolute flex flex-col justify-center rounded-xl bg-hl-lavender text-center text-hl-indigo"
      style={{
        ...at(props.origin[0], props.origin[1]),
        width: u(ASIDE.w),
        minHeight: u(ASIDE.minH),
        padding: `${u(ASIDE.padY)} ${u(ASIDE.padX)}`,
      }}
    >
      <h3
        className="font-display font-bold"
        style={{ fontSize: u(ASIDE.titleSize), lineHeight: 1.15 }}
      >
        {aside.title}
      </h3>
      <p
        style={{
          marginTop: u(ASIDE.gap),
          fontSize: u(ASIDE.bodySize),
          lineHeight: 1.5,
        }}
      >
        {aside.body}
      </p>
      {/* Parked: corner decals, to be placed later. <CornerDecal decal={decal} /> */}
    </div>
  );
}
