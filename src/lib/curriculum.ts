import type { Checkpoint, Phase, WeekMeta } from "./types"

/**
 * Tiers and the build-week ask are program configuration, not curriculum, and
 * the ledger reads them too. They are re-exported here because every component
 * on the trail already reaches for them through this module, and one of the
 * two copies that used to exist would eventually have drifted from the other.
 */
export { BUILD_BLOCKS, BUILD_HOURS } from "./config/program"
export { TIERS } from "./config/tiers"
export type { Tier } from "./config/tiers"

/**
 * Ten weeks: five design weeks, then the same five themes built for real.
 * A design week opens by settling what is being made — the yellow onboarding
 * checkpoint in week 1, the project form after that — and then pitches it in
 * the idea reel before a single hour is logged against it. Build weeks skip
 * both and end on a working-demo video.
 */

interface ThemeSeed {
  theme: string
  designHeadline: string
  buildHeadline: string
  fullName: string
  summary: string
  primer: string
  examples: string[]
  accent: string
  accentDeep: string
}

const THEMES: ThemeSeed[] = [
  {
    theme: "PCB",
    designHeadline: "DESIGN YOUR PCB",
    buildHeadline: "SOLDER YOUR PCB",
    fullName: "Printed Circuit Board Week",
    summary: "Draw a schematic, route a board, and order it from a real fab.",
    primer:
      "A PCB is the flat green (or purple, or black) board inside every piece of electronics. Copper lines etched onto it replace the messy wires you would otherwise solder by hand. You will draw a schematic — a diagram of which part connects to which — then lay those parts out on a board and let the software route copper between them. At the end you export a set of Gerber files and a real factory turns them into a board you can hold.",
    examples: [
      "A macropad with hot-swap sockets and per-key LEDs",
      "An ESP32 dev board with a built-in battery charger",
      "A USB-C power delivery trigger you can set with a dial",
      "A badge PCB shaped like your handle, with blinky eyes",
    ],
    accent: "var(--color-sky)",
    accentDeep: "var(--color-sky-deep)",
  },
  {
    theme: "CAD",
    designHeadline: "MODEL YOUR PART",
    buildHeadline: "PRINT YOUR PART",
    fullName: "Computer Aided Design Week",
    summary: "Model a part in 3D with tolerances that survive a real printer.",
    primer:
      "CAD is drawing an object as a solid with exact dimensions instead of a sketch. You start from a 2D sketch, pull it into 3D, then cut and round it until it is the shape you want. The hard part is not the software — it is tolerance: a hole modelled at exactly 3mm will not fit a 3mm screw once the printer squishes plastic into it.",
    examples: [
      "An enclosure for the PCB you designed in week 1",
      "A desk arm that clamps a phone at eye height",
      "A parametric spool holder that fits any spool width",
      "A mechanical keyboard case with a gasket mount",
    ],
    accent: "var(--color-teal)",
    accentDeep: "var(--color-teal-deep)",
  },
  {
    theme: "Synth",
    designHeadline: "DESIGN YOUR SYNTH",
    buildHeadline: "WIRE YOUR SYNTH",
    fullName: "Synth & Music Week",
    summary: "Make something that makes noise on purpose.",
    primer:
      "A synth turns voltage into sound. The simplest one is an oscillator — a circuit that flips a pin on and off fast enough to hear — plus something to shape the volume over time. Add a filter and you have a voice. You can build this from a 555 timer, from op-amps, or from a microcontroller running a wavetable. All three count.",
    examples: [
      "A 555-based drone synth with three detuned oscillators",
      "A MIDI controller with velocity-sensitive pads",
      "A Eurorack-format LFO module in 4HP",
      "A pocket sampler that records to an SD card",
    ],
    accent: "var(--color-magenta)",
    accentDeep: "#7d0f6c",
  },
  {
    theme: "Displays",
    designHeadline: "DESIGN YOUR DISPLAY",
    buildHeadline: "DRIVE YOUR DISPLAY",
    fullName: "Displays Week",
    summary: "Put pixels somewhere they do not belong.",
    primer:
      "Displays are the fastest way to make a project feel finished. E-paper sips power and holds an image with none. OLED is crisp and tiny. LED matrices are bright enough to read across a room. Each one talks a different protocol — SPI, I2C, or raw shift registers — and the driver you pick decides how much of your microcontroller is left over for anything else.",
    examples: [
      "An e-paper name badge that updates over Bluetooth",
      "A 32x32 LED matrix that mirrors your now-playing track",
      "A split-flap display driven by stepper motors",
      "A tiny OLED wristwatch with a custom watchface",
    ],
    accent: "var(--color-orange)",
    accentDeep: "var(--color-orange-deep)",
  },
  {
    theme: "Breadboard computer",
    designHeadline: "PLAN YOUR COMPUTER",
    buildHeadline: "BUILD YOUR COMPUTER",
    fullName: "Breadboard Computer Week",
    summary: "A working computer out of logic chips and a lot of wire.",
    primer:
      "Underneath every processor is a clock, a register, an adder and some way to decide what happens next. Wire those four things together out of 74-series logic chips and you have a computer — slow, hot, and entirely yours. Start with the clock module, get an LED blinking at a speed you can follow, then add a register you can load by hand.",
    examples: [
      "An 8-bit SAP-1 computer across four breadboards",
      "A 4-bit ALU with carry-lookahead you can single-step",
      "A relay-based adder you can hear compute",
      "A programmable clock module with manual step mode",
    ],
    accent: "var(--color-violet)",
    accentDeep: "var(--color-violet-deep)",
  },
]

const cp = (c: Checkpoint): Checkpoint => c

/** Every week's fixed half — everything that does not depend on the tier. */
export const WEEK_META: WeekMeta[] = [
  ...THEMES.map((seed, i) => ({
    id: i + 1,
    phase: "design" as Phase,
    theme: seed.theme,
    headline: seed.designHeadline,
    fullName: seed.fullName,
    summary: seed.summary,
    primer: seed.primer,
    examples: seed.examples,
    accent: seed.accent,
    accentDeep: seed.accentDeep,
  })),
  ...THEMES.map((seed, i) => ({
    id: i + 6,
    phase: "build" as Phase,
    theme: seed.theme,
    headline: seed.buildHeadline,
    fullName: `${seed.fullName} — Build`,
    summary: `Assemble the ${seed.theme.toLowerCase()} project you designed in week ${i + 1}.`,
    primer: seed.primer,
    examples: seed.examples,
    accent: seed.accent,
    accentDeep: seed.accentDeep,
  })),
]

/** Progress reels land on the clock: one every ten hours logged, indefinitely. */
export const REEL_EVERY = 10

/**
 * A session has to be backed by photographs. Two is the floor whatever the
 * claim, and past two hours it is one an hour — a long session has to show
 * more of itself than a short one, which is the only thing standing between a
 * self-reported number and a made-up one.
 */
export const MIN_PHOTOS = 2
export const photosRequired = (hours: number) => Math.max(MIN_PHOTOS, Math.ceil(hours))

/**
 * The week's checkpoints.
 *
 * Every journal entry is its own node, so the trail is as long as the work
 * actually was — plus one live node for the entry about to be written.
 *
 * There are exactly three occasions for a reel and no others: the idea at the
 * start, a progress reel every ten hours, and the one that closes the week
 * inside Submit. The progress reels are placed at the entry that crossed the
 * mark, so the trail reads as a chronology rather than a queue with the reels
 * swept to the end, and the next unearned one trails the chain so the cadence
 * is visible before you get there.
 *
 * Submit opens the moment the tier's funded hours are on the board, and from
 * then on the trail forks rather than continuing: the live entry and Submit
 * come off the chain and sit side by side as a choice — one more session, or
 * wrap the week up. Finishing one of them is what settles the route, so
 * nothing is committed by clicking. The closing reel is not a node at all; it
 * is the last step inside Submit, so submitting always ships a reel.
 *
 * A submitted week has no live entry and no pending reel: the choice was made,
 * and what is left on the trail is the road actually taken.
 */
export function checkpointsFor(
  meta: WeekMeta,
  entryMinutes: number[],
  isDone: (id: string) => boolean,
  /**
   * The hours this week has to reach before it can be handed in. Passed in
   * rather than worked out here: it depends on the goal catalogue, and the
   * catalogue already reads the season out of this file.
   */
  submitHours: number,
): Checkpoint[] {
  const id = (n: string) => `w${meta.id}-${n}`
  const out: Checkpoint[] = []

  const entry = (n: number, branch?: "keep") =>
    cp({
      id: id(`entry-${n}`),
      weekId: meta.id,
      kind: "journal",
      title: branch ? "Keep working" : `Entry ${n}`,
      blurb: "One session: what you did, and the photos that prove it.",
      entryTarget: 1,
      branch,
      // The fork's working arm answers to the week's clock rather than to the
      // node before it, so a reel that has fallen due holds it shut exactly as
      // it holds Submit shut. Zero, because carrying on is never gated on
      // hours of its own — only on what the hours have already earned.
      atHours: branch ? 0 : undefined,
    })

  const milestoneReel = (k: number) =>
    cp({
      id: id(`reel-${k}`),
      weekId: meta.id,
      kind: "reel",
      atHours: k * REEL_EVERY,
      title: `${k * REEL_EVERY}h progress reel`,
      blurb: k === 1 ? "Ten hours in. Show where the work actually got to." : "What has changed since the last one.",
      reelBrief:
        k === 1
          ? "Screen-share what you have and narrate one decision you reversed."
          : "Put the last version next to this one and say what moved.",
    })

  // Past the submit floor the live entry leaves the chain and pairs with Submit
  // as a fork, so the walk stops one short of it. A submitted week has no live
  // entry at all — the route is settled and the trail shows only what happened.
  const submitted = isDone(id("submit"))
  const floorHours = submitHours
  const loggedHours = entryMinutes.reduce((n, m) => n + m, 0) / 60
  const forked = !submitted && loggedHours >= floorHours

  // Walk the entries, dropping a reel in wherever the clock crosses ten hours.
  let hours = 0
  let reels = 0
  const live = submitted || forked ? entryMinutes.length : entryMinutes.length + 1
  const pushEntry = (n: number) => {
    out.push(entry(n))
    hours += (entryMinutes[n - 1] ?? 0) / 60
    while (Math.floor(hours / REEL_EVERY) > reels) {
      reels += 1
      out.push(milestoneReel(reels))
    }
  }

  if (meta.phase === "design") {
    const ideaReel = cp({
      id: id("reel-idea"),
      weekId: meta.id,
      kind: "reel",
      title: "Idea reel",
      blurb: "30 seconds on what you are making and why anyone should care.",
      reelBrief: "Hold up a sketch, say the idea out loud, name one thing you are unsure about.",
    })

    // Every design week opens the same way: say what you are making, then
    // start logging the making of it. Week one differs only in how the
    // project comes into existence — the questionnaire stands in for the
    // form, and the pitch follows it exactly as it does every other week.
    out.push(
      meta.id === 1
        ? cp({
            id: id("onboard"),
            weekId: meta.id,
            kind: "onboarding",
            title: "Get started",
            blurb: "Six quick questions, then your first project exists.",
          })
        : cp({
            id: id("project"),
            weekId: meta.id,
            kind: "project",
            title: "New project",
            blurb: `Name your ${meta.theme.toLowerCase()} project and pick a funding tier.`,
          }),
      ideaReel,
    )
    for (let n = 1; n <= live; n += 1) pushEntry(n)
  } else {
    for (let n = 1; n <= live; n += 1) pushEntry(n)
  }

  // The next one on the clock, so the cadence is visible before you get there.
  // Two weeks have no use for it. A submitted week has already shipped its
  // closing reel inside Submit, so an unearned one trailing the chain would be
  // a node nobody can ever take. And a forked week ends in a question: a
  // locked node standing between the last of the work and that question reads
  // as a step you have to clear first, when in truth it gates nothing and only
  // belongs to one of the two answers. It comes back the moment the hours
  // earn it.
  if (!submitted && !forked) out.push(milestoneReel(reels + 1))

  const submit = cp({
    id: id("submit"),
    weekId: meta.id,
    // Opens on the week's submit floor — the moment wrapping up becomes a
    // real choice rather than the only road left.
    atHours: floorHours,
    kind: "submit",
    title: forked ? "Submit project" : "Submit",
    blurb:
      meta.phase === "build"
        ? "A working demo, or an honest write-up of what still needs changing."
        : "Files, bill of materials, your tier, and the reel that closes the week.",
    branch: forked ? "submit" : undefined,
  })

  // The fork. Both halves are the last row of the week and the renderer lays
  // them side by side; ordering them keep-then-submit is what puts carrying on
  // on the left, which is the one the trail has been travelling towards.
  if (forked) out.push(entry(live + 1, "keep"), submit)
  else out.push(submit)

  return out
}

export const STARTER_IDEAS = [
  {
    id: "macropad",
    name: "Three-key macropad",
    blurb: "Three switches, one microcontroller, zero surprises.",
    art: "pcb" as const,
  },
  {
    id: "badge",
    name: "Blinky name badge",
    blurb: "Your handle in copper with two LEDs for eyes.",
    art: "badge" as const,
  },
  {
    id: "usb",
    name: "USB-C breakout",
    blurb: "Break a USB-C port out to pins you can actually probe.",
    art: "usb" as const,
  },
  {
    id: "sensor",
    name: "Desk air monitor",
    blurb: "One sensor, one display, one small board.",
    art: "sensor" as const,
  },
]

export const SUBMIT_FILES_DESIGN = [
  { id: "schematic", label: "Schematic (.kicad_sch or PDF)", hint: "Every net named, no floating pins." },
  { id: "layout", label: "Board layout (.kicad_pcb)", hint: "Source file, not just an export." },
  { id: "gerbers", label: "Gerbers + drill files (.zip)", hint: "The exact zip you would hand a fab." },
  { id: "readme", label: "README with build notes", hint: "What it does, what you would change." },
  { id: "photos", label: "Renders or screenshots", hint: "At least one 3D view of the board." },
]

export const SUBMIT_FILES_BUILD = [
  { id: "demo", label: "30–60 second working demo", hint: "Show it doing the thing, with your voice over it." },
  { id: "photos", label: "Three photos of the finished build", hint: "Front, back, and one detail shot." },
  { id: "notes", label: "Assembly notes", hint: "What you got wrong the first time." },
]
