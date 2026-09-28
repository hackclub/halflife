/**
 * Every word and fact on the page. Copy is taken from the approved comp
 * (Figma "landing page (claude)", node 275:8). Nothing here is invented:
 * program claims — dates, prize list, funding cap, community size —
 * are the comp's own.
 *
 * Artwork is imported rather than named by path. A string path is a promise
 * the build cannot check and the cache cannot see through: `/art/build.png`
 * stays the same URL when the file behind it changes, so Next's optimizer goes
 * on serving what it cached under that key — four hours by default — and a
 * replaced picture does not appear. An import is resolved at build time, so a
 * missing file is a build error rather than a 404 nobody notices, and the URL
 * carries a hash of the file's own bytes: replace the art and the URL changes
 * with it, which invalidates every cache between here and the browser without
 * anyone having to remember to clear one.
 */
import type { StaticImageData } from "next/image"

import buildArt from "../../../public/art/build.png"
import getFundingArt from "../../../public/art/getfunding.png"
import prizesArt from "../../../public/art/prizes.png"
import allWeeksArt from "../../../public/art/weeks/allweeks.png"
import flightControllerPhoto from "../../../public/projects/flightcontroller.png"
import hexapodPhoto from "../../../public/projects/hexapod.png"
import icepiPhoto from "../../../public/projects/icepi.png"
import jukeboxPhoto from "../../../public/projects/jukebox.png"
import macropadPhoto from "../../../public/projects/macropad.png"

export const BRAND = {
  name: "Half Life",
  tagline: "become a hardware expert in 10 weeks, get a 3D printer",
  /**
   * Under the email field. The one line here that is not the comp's: it was
   * asked for directly, and it is the two things someone hesitating over the
   * field wants settled before they type. Lowercase to match the tagline
   * above it; en dash because 13-18 is a range.
   */
  eligibility: "teens 13-18. no experience necessary. free to participate.",
} as const

/**
 * The dateline strip across the top of the page.
 *
 * The one dated claim on the site, and the only place a calendar date is
 * written down, so it is the one thing here that goes stale on its own. Change
 * `date` when the start moves; nothing else reads it. `submitHref` is the
 * project submission form, and goes stale on the same terms.
 *
 * It is split rather than stored as one sentence because two of its pieces are
 * not plain text: the date is the fact the strip exists to carry and is the
 * only thing set in the page's accent colour, and `submitLabel` is the word
 * the anchor wraps — see `announcement-banner.tsx`. Splitting them in the data
 * keeps the component free of string surgery on copy it does not own.
 *
 * "Warm Up Week 1" is the programme's own pre-season phase and is not the
 * `week 1` of `DESIGN_WEEKS`, which is PCBs. Capitals are the phase's name,
 * not a departure from the page's lowercase headings: this is running prose,
 * which is sentence case everywhere else here too.
 */
export const ANNOUNCEMENT = {
  lead: "Warm Up Week 2 started on",
  date: "September 21st",
  tail: "! Submit projects ",
  submitLabel: "here",
  submitHref: "https://forms.hackclub.com/halflifesubmit",
} as const

export type DesignWeek = {
  subject: string
  week: string
  /**
   * The artwork behind this pairing, as a path under `public/`. Optional on
   * the same terms as a `BuildCard`'s photo: a week without one falls back to
   * the drawn slot, so the five fill in one week at a time. Both layouts read
   * it from here, so a new picture lands on the stage and in the stacked
   * column from one edit.
   *
   * Week 3 has none yet — `public/art/weeks` ships PCB, cad, display and
   * breadboard, and nothing for music.
   */
  art?: string
}

/** Week 1 leads at display scale; weeks 2–5 sit beneath it. */
export const DESIGN_WEEKS: { lead: DesignWeek; rest: DesignWeek[] } = {
  lead: { subject: "PCBs", week: "week 1", art: "/art/weeks/PCB.png" },
  rest: [
    { subject: "CAD", week: "week 2", art: "/art/weeks/cad.png" },
    { subject: "music", week: "week 3" },
    { subject: "displays", week: "week 4", art: "/art/weeks/display.png" },
    {
      subject: "breadboard logic",
      week: "week 5",
      art: "/art/weeks/breadboard.png",
    },
  ],
}

export type Step = {
  id: string
  title: string
  /**
   * The step's artwork, on the same terms as a `DesignWeek`'s `art` and a
   * `BuildCard`'s `photo`: an optional path, with `slot` drawn as the fallback
   * while a step is still waiting for its picture. `slot` stays on a step that
   * has its art — it is the in-source record of the footprint the comp drew.
   */
  art?: StaticImageData
  /** Slot the user drops a real photo into. */
  slot?: { label: string; ratio: string }
  caption?: string
}

/** Exactly four, in comp order: design, funding, build, printer. The
 *  arity is load-bearing — `process.tsx` destructures these positionally
 *  and gives each one its own plate. */
export const STEPS: [Step, Step, Step, Step] = [
  {
    id: "design",
    title: "spend 5 weeks designing 5 projects",
    art: allWeeksArt,
  },
  {
    id: "funding",
    title: "get funding and order your parts!",
    art: getFundingArt,
    slot: { label: "order flow", ratio: "736 × 155" },
    caption: "up to $100 per project!",
  },
  {
    id: "build",
    title: "then spend 5 weeks building your projects!",
    art: buildArt,
    slot: { label: "build photo", ratio: "736 × 269" },
  },
  {
    id: "printer",
    title: "get a 3D printer!",
    art: prizesArt,
    slot: { label: "prize lineup", ratio: "736 × 269" },
  },
]

export type Aside = { id: string; title: string; body: string }

/** Exactly two; each is placed at its own offset on the process band. */
export const ASIDES: [Aside, Aside] = [
  {
    id: "viral",
    title: "earn more prizes by going viral!",
    body: "Make videos, posts, and blogs about your Half Life projects! If they hit our virality threshold, you'll earn extra prizes like plushies, drawing tablets, and iPads!",
  },
  {
    id: "community",
    title: "there are thousands of us!",
    body: "Hack Club has a community of over 100,000 teenagers from around the globe, who all love building projects and learning how to build projects. Join now at hackclub.com/slack!",
  },
]

export type BuildCard = {
  id: string
  /** Names the project. Not drawn -- it is the photograph's alt text. */
  label: string
  credit: string
  /**
   * The project photograph, as a path under `public/`. Optional on purpose: a
   * card without one falls back to the drawn slot, so the belt fills up one
   * project at a time instead of needing the whole set before it renders.
   */
  photo?: StaticImageData
  /**
   * ── PUT THE GITHUB LINK HERE ──────────────────────────────────────────
   * Full URL to the project's repo, e.g.
   *   repo: "https://github.com/hackclub/half-life",
   * Optional: a card left empty here simply shows no button, so the repos
   * can be filled in one project at a time.
   */
  repo?: string
  /** The drawn footprint, standing in until `photo` lands. */
  slot: { label: string; ratio: string }
}

export const BUILD_CARDS: BuildCard[] = [
  {
    id: "hexapod",
    label: "Hexapod robot",
    credit: "by Joshua, 18, from Quebec",
    photo: hexapodPhoto,
    repo: "https://github.com/Josh4minee/HEX-B12.V1",
    slot: { label: "project photo", ratio: "329 x 377" },
  },
  {
    id: "jukebox",
    label: "Minecraft Jukebox",
    credit: "by Dani, 17, from New York",
    photo: jukeboxPhoto,
    repo: "https://github.com/danieliscrazy/Jukebox",
    slot: { label: "project photo", ratio: "329 x 377" },
  },
  {
    id: "macropad",
    label: "12-key Macropad",
    credit: "by Nirvaan, 14, from New Jersey",
    photo: macropadPhoto,
    repo: "https://github.com/OakTreeWC/12KEMPV2.1",
    slot: { label: "project photo", ratio: "329 x 377" },
  },
  {
    id: "flightcontroller",
    label: "Rocket Flight Controller",
    credit: "by Archit, 15, from Australia",
    photo: flightControllerPhoto,
    repo: "https://github.com/codinga593/IRIS",
    slot: { label: "project photo", ratio: "329 x 377" },
  },
  {
    id: "icepi",
    label: "Icepi Zero FPGA Devboard",
    credit: "by Cyao, 18, from France",
    photo: icepiPhoto,
    repo: "https://github.com/cheyao/icepi-zero",
    slot: { label: "project photo", ratio: "329 x 377" },
  },
]

export type Faq = { q: string; a: string }

export const FAQS: Faq[] = [
  {
    q: "Who is this for?",
    a: "Half Life is for teenagers 13-18 (inclusive)! Whether you've never touched hardware before or you're a multiplexing master, Half Life is your place to become a well-rounded hardware expert.",
  },
  {
    q: "I don't know hardware!",
    a: "That's okay! We have guided projects and hardware experts to help you out. Half Life is for beginners, experts, and all the levels in between.",
  },
  {
    q: "Is this free?",
    a: "Yep! Hack Club programs are free to participate in. We provide funding for hardware projects and all prizes (like 3D printers) are free! We do not cover customs costs.",
  },
  {
    q: "When does this start?",
    a: "Half Life is running for 10 weeks! September 14th to October 4th will be warmup weeks 1-3 (where you can submit any hardware project and get funding from up $100), and then PCB Week will start!",
  },
  {
    q: "What's Hack Club?",
    a: "Hack Club is a 501(c)(3) nonprofit that helps teenagers around the world build technical projects and go on awesome adventures!",
  },
  {
    q: "What do I get?",
    a: "Up to $100 of funding per project, a 3D printer for finishing all ten weeks, and extra prizes (like plushies, drawing tablets, and iPads) if you log more hours.",
  },
]

/**
 * The one group shot under "here's what you'll make!" — every project in a
 * single frame, where the comp scattered five separate prints.
 *
 * Currently rendered as an `ImageSlot`. To ship the real photograph: drop it
 * at `/art/make/make-all.png`, then swap `ImageSlot` for `next/image` in
 * `hero.tsx` — both call sites already reserve the correct box, so nothing
 * around them has to move.
 */
export const MAKE_PHOTO = {
  label: "every project",
  /** Footprint on the comp's 1728px grid; supply the art at 2x. */
  ratio: "380 × 214",
} as const

export const FOOTER_COLUMNS = [
  {
    heading: "Half Life",
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "What you can build", href: "#what-can-i-build" },
      { label: "FAQ", href: "#faq" },
      { label: "Sign up", href: "#signup" },
    ],
  },
  {
    heading: "Hack Club",
    links: [
      { label: "hackclub.com", href: "https://hackclub.com" },
      { label: "Philosophy", href: "https://hackclub.com/philosophy" },
      { label: "Team", href: "https://hackclub.com/team" },
      { label: "Donate", href: "https://hackclub.com/donate" },
    ],
  },
  {
    heading: "Community",
    links: [
      { label: "Slack", href: "https://hackclub.com/slack" },
      { label: "GitHub", href: "https://github.com/hackclub" },
      { label: "Conduct", href: "https://hackclub.com/conduct" },
    ],
  },
] as const
