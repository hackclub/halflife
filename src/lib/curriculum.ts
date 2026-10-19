import type { Checkpoint, Phase, WeekMeta } from "./types"

/**
 * Tiers and the build-week ask are program configuration, not curriculum, and the ledger reads them too. They are re-exported here because every component on the trail already reaches for them through this module, and one of the two copies that used to exist would eventually have drifted from the other.
 */
export { BUILD_BLOCKS, BUILD_HOURS } from "./config/program"
export type { Tier } from "./config/tiers"
export { TIERS } from "./config/tiers"

/**
 * Ten weeks: five design weeks, then the same five themes built for real. A design week opens by settling what is being made – the yellow onboarding checkpoint in week 1, the project form after that – and then pitches it in the idea reel before a single hour is logged against it. Week 1 is the exception: the reel is optional there, offered side by side with the first devlog entry instead of gating it. Build weeks skip both and end on a working-demo video.
 */

interface ThemeSeed {
	accent: string
	accentDeep: string
	buildHeadline: string
	designHeadline: string
	examples: string[]
	fullName: string
	primer: string
	summary: string
	theme: string
}

const THEMES: ThemeSeed[] = [
	{
		accent: "var(--color-sky)",
		accentDeep: "var(--color-sky-deep)",
		buildHeadline: "BUILD YOUR PCB",
		designHeadline: "DESIGN YOUR PCB",
		examples: [
			"A macropad with hot-swap sockets and per-key LEDs",
			"An ESP32 dev board with a built-in battery charger",
			"A USB-C power delivery trigger you can set with a dial",
			"A badge PCB shaped like your handle, with blinky eyes",
		],
		fullName: "Printed Circuit Board Week",
		primer:
			"A PCB is the flat green (or purple, or black) board inside every piece of electronics. Copper lines etched onto it replace the messy wires you would otherwise solder by hand. You will draw a schematic – a diagram of which part connects to which – then lay those parts out on a board and let the software route copper between them. At the end you export a set of Gerber files and a real factory turns them into a board you can hold.",
		summary: "Draw up a schematic, make a BOM, and route your board!",
		theme: "PCB",
	},
	{
		accent: "var(--color-teal)",
		accentDeep: "var(--color-teal-deep)",
		buildHeadline: "PRINT YOUR PART",
		designHeadline: "MODEL YOUR PART",
		examples: [
			// "An enclosure for the PCB you designed in week 1", // cant do this one
			"A desk arm that clamps a phone at eye height",
			"A parametric spool holder that fits any spool width",
			"A mechanical keyboard case with a gasket mount",
		],
		fullName: "Computer Aided Design Week",
		primer:
			"CAD is drawing an object as a solid with exact dimensions instead of a sketch. You start from a 2D sketch, pull it into 3D, then cut and round it until it is the shape you want. The hard part is not the software – it is tolerance: a hole modelled at exactly 3mm will not fit a 3mm screw once the printer squishes plastic into it.",
		summary: "Make some awesome 3D models (remember tolerances!)",
		theme: "CAD",
	},
	{
		accent: "var(--color-magenta)",
		accentDeep: "#7d0f6c",
		buildHeadline: "WIRE YOUR INSTRUMENT",
		designHeadline: "DESIGN YOUR INSTRUMENT",
		examples: [
			"A 555-based drone machine with three detuned oscillators",
			"A MIDI controller with velocity-sensitive pads",
			"A Eurorack-format LFO module in 4HP",
			"A pocket sampler that records to an SD card",
		],
		fullName: "Music Week",
		primer:
			"Music week is circuits that turn voltage into sound. The simplest instrument is an oscillator – a circuit that flips a pin on and off fast enough to hear – plus something to shape the volume over time. Add a filter and you have a voice. You can build this from a 555 timer, from op-amps, or from a microcontroller running a wavetable. All three count.",
		summary: "MAKE. SOME. NOOOOOOOOOOOOOISE.",
		theme: "Music",
	},
	{
		accent: "var(--color-orange)",
		accentDeep: "var(--color-orange-deep)",
		buildHeadline: "DRIVE YOUR DISPLAY",
		designHeadline: "DESIGN WITH DISPLAYS",
		examples: [
			"An e-paper name badge that updates over Bluetooth",
			"A 32x32 LED matrix that mirrors your now-playing track",
			"A split-flap display driven by stepper motors",
			"A tiny OLED wristwatch with a custom watchface",
		],
		fullName: "Displays Week",
		primer:
			"Displays are the fastest way to make a project feel finished. E-paper sips power and holds an image with none. OLED is crisp and tiny. LED matrices are bright enough to read across a room. Each one talks a different protocol – SPI, I2C, or raw shift registers – and the driver you pick decides how much of your microcontroller is left over for anything else.",
		summary: "TFT? OLED? Nixie tubes? Neopixels? LED matrices?",
		theme: "Displays",
	},
	{
		accent: "var(--color-violet)",
		accentDeep: "var(--color-violet-deep)",
		buildHeadline: "BUILD YOUR COMPUTER",
		designHeadline: "DESIGN YOUR COMPUTER",
		examples: [
			"An 8-bit SAP-1 computer across four breadboards",
			"A 4-bit ALU with carry-lookahead you can single-step",
			"A relay-based adder you can hear compute",
			"A programmable clock module with manual step mode",
		],
		fullName: "Breadboard Computer Week",
		primer:
			"Underneath every processor is a clock, a register, an adder and some way to decide what happens next. Wire those four things together out of 74-series logic chips and you have a computer – slow, hot, and entirely yours. Start with the clock module, get an LED blinking at a speed you can follow, then add a register you can load by hand.",
		summary: "Plan your circuit! Simulate some gates!",
		theme: "Breadboard computer",
	},
]

const cp = (c: Checkpoint): Checkpoint => c

/** Every week's fixed half – everything that does not depend on the tier. */
export const WEEK_META: WeekMeta[] = [
	...THEMES.map((seed, i) => ({
		accent: seed.accent,
		accentDeep: seed.accentDeep,
		examples: seed.examples,
		fullName: seed.fullName,
		headline: seed.designHeadline,
		id: i + 1,
		phase: "design" as Phase,
		primer: seed.primer,
		summary: seed.summary,
		theme: seed.theme,
	})),
	...THEMES.map((seed, i) => ({
		accent: seed.accent,
		accentDeep: seed.accentDeep,
		examples: seed.examples,
		fullName: `${seed.fullName} – Build`,
		headline: seed.buildHeadline,
		id: i + 6,
		phase: "build" as Phase,
		primer: seed.primer,
		summary: `Assemble the ${seed.theme.toLowerCase()} project you designed in week ${i + 1}.`,
		theme: seed.theme,
	})),
]

/**
 * The hours logged at which a week's k-th progress reel falls due (k from 1).
 *
 * On the clock, sized to what the week asks.
 *
 * A design week's reels fall at **five hours, then every ten after that** – 5h, 15h, 25h, 35h. Not at ten and then every ten, which is what this was, because a design week can be handed in before ten hours: the floor is the tier's funded hours and tier 1 is six. A tier-1 maker submitting at six never reached a ten-hour mark, so the reel that was supposed to show their progress was a node that never appeared – the week was over before the first one came due. Five sits under the lowest floor in the programme, so it lands for everyone who can submit at all, and the ten-hour spacing keeps every later one a real milestone rather than a nag.
 *
 * A build week asks only five hours, so ten would mean most builds never show their progress at all: its first reel comes at two and a half hours – halfway to the minimum – and then one every five hours on the clock: 2.5h, 5h, 10h, 15h…
 *
 * Keys stay `w<week>-reel-<k>`, numbered rather than timed, so this can change without touching a stored reel; the reels page names them from it too.
 */
export function progressReelHours(phase: Phase, k: number): number {
	if (phase === "build") return k === 1 ? 2.5 : (k - 1) * 5
	// 5h, 15h, 25h… – the first under the cheapest tier's floor, then every ten.
	if (k <= 1) return 5
	return 5 + (k - 1) * 10
}

/**
 * A session has to be backed by photographs. Two is the floor whatever the claim, and past two hours it is one an hour – a long session has to show more of itself than a short one, which is the only thing standing between a self-reported number and a made-up one.
 */
export const MIN_PHOTOS = 2
export const photosRequired = (hours: number) => Math.max(MIN_PHOTOS, Math.ceil(hours))

/**
 * The week's checkpoints.
 *
 * Every journal entry is its own node, so the trail is as long as the work actually was – plus one live node for the entry about to be written.
 *
 * There are exactly three occasions for a reel and no others: the idea at the start, a progress reel as the hours mount (`progressReelHours`), and the one that closes the week inside Submit. The progress reels are placed at the entry that crossed the mark, so the trail reads as a chronology rather than a queue with the reels swept to the end, and the next unearned one trails the chain so the cadence is visible before you get there.
 *
 * Week 1 is the exception to the opening: its idea reel is optional, so the trail forks right after setup – the idea reel on one arm, the first devlog entry on the other. The entry arm is the road onward; nothing past the fork waits on the reel, and the reel stays postable as an extra whenever. Other design weeks keep the reel as a straight gate before the first entry.
 *
 * Submit opens the moment the tier's funded hours are on the board, and from then on the trail forks rather than continuing: the live entry and Submit come off the chain and sit side by side as a choice – one more session, or wrap the week up. Finishing one of them is what settles the route, so nothing is committed by clicking. The closing reel is not a node at all; it is the last step inside Submit, so submitting always ships a reel.
 *
 * A submitted week has no live entry and no pending reel: the choice was made, and what is left on the trail is the road actually taken.
 */
export function checkpointsFor(
	meta: WeekMeta,
	entryMinutes: number[],
	isDone: (id: string) => boolean,
	/**
	 * The hours this week has to reach before it can be handed in. Passed in rather than worked out here: it depends on the goal catalogue, and the catalogue already reads the season out of this file.
	 */
	submitHours: number,
	/**
	 * Week one only: its project was deleted after onboarding made it. The questionnaire does not run twice, so the week gets the "New project" node every other design week opens with, right after the done "Get started".
	 */
	needsProject = false,
): Checkpoint[] {
	const id = (n: string) => `w${meta.id}-${n}`
	const out: Checkpoint[] = []

	const entry = (n: number, branch?: "keep" | "skip") =>
		cp({
			// The fork's working arm answers to the week's clock rather than to the node before it, so a reel that has fallen due holds it shut exactly as it holds Submit shut. Zero, because carrying on is never gated on hours of its own – only on what the hours have already earned. The week-1 skip arm is an ordinary journal node: it unlocks off the setup before it, not off the clock.
			atHours: branch === "keep" ? 0 : undefined,
			blurb: "Journal your progress with pictures and screenshots! More nodes will show up once you start journaling.",
			branch,
			entryTarget: 1,
			id: id(`entry-${n}`),
			kind: "journal",
			title: branch === "keep" ? "Keep working" : `Entry ${n}`,
			weekId: meta.id,
		})

	const milestoneReel = (k: number) =>
		cp({
			atHours: progressReelHours(meta.phase, k),
			blurb:
				k === 1
					? `Show off the progress you've made after ${progressReelHours(meta.phase, k)} hours!`
					: "What has changed since the last one.",
			id: id(`reel-${k}`),
			kind: "reel",
			reelBrief:
				k === 1
					? "Screen-share what you have and narrate one decision you reversed."
					: "Put the last version next to this one and say what moved.",
			title: `${progressReelHours(meta.phase, k)}h progress reel`,
			weekId: meta.id,
		})

	// Past the submit floor the live entry leaves the chain and pairs with Submit as a fork, so the walk stops one short of it. A submitted week has no live entry at all – the route is settled and the trail shows only what happened.
	const submitted = isDone(id("submit"))
	const floorHours = submitHours
	const loggedHours = entryMinutes.reduce((n, m) => n + m, 0) / 60
	const forked = !submitted && loggedHours >= floorHours

	// Walk the entries, dropping a reel in wherever the clock crosses a reel's mark.
	let hours = 0
	let reels = 0
	const live = submitted || forked ? entryMinutes.length : entryMinutes.length + 1
	const pushEntry = (n: number) => {
		out.push(entry(n))
		hours += (entryMinutes[n - 1] ?? 0) / 60
		while (hours >= progressReelHours(meta.phase, reels + 1)) {
			reels += 1
			out.push(milestoneReel(reels))
		}
	}

	if (meta.phase === "design") {
		// Week 1 only: the pitch is a choice, not a gate. Both arms carry a branch so the renderer lays them side by side with an "or" between them, exactly as it does the keep/submit fork at the end of a week.
		const ideaReel = cp({
			blurb: "A short video about your awesome project idea!",
			branch: meta.id === 1 ? "idea" : undefined,
			id: id("reel-idea"),
			kind: "reel",
			reelBrief: "Talk about the idea you're thinking about designing this week.",
			title: "Idea reel",
			weekId: meta.id,
		})

		// Every design week opens the same way: say what you are making, then start logging the making of it. Week one differs only in how the project comes into existence – the questionnaire stands in for the form, and the pitch follows it exactly as it does every other week.
		const newProject = cp({
			blurb: `Create your ${meta.theme.toLowerCase()} project!`,
			id: id("project"),
			kind: "project",
			title: "New project",
			weekId: meta.id,
		})
		if (meta.id === 1) {
			out.push(
				cp({
					blurb: "Six short questions, then we're off!",
					id: id("onboard"),
					kind: "onboarding",
					title: "Get started",
					weekId: meta.id,
				}),
			)
			if (needsProject) out.push(newProject)
			// The fork: the idea reel, or straight to the first devlog. The entry arm is entry 1 itself, so skipping is just starting the work – no extra "skip" node to settle. A submitted week with no entries logged them nowhere (Hackatime-only), so there is no live entry to offer; the reel stands alone as it always has.
			out.push(ideaReel)
			if (!submitted || entryMinutes.length > 0) {
				out.push(entry(1, "skip"))
				hours += (entryMinutes[0] ?? 0) / 60
				while (hours >= progressReelHours(meta.phase, reels + 1)) {
					reels += 1
					out.push(milestoneReel(reels))
				}
				for (let n = 2; n <= live; n += 1) pushEntry(n)
			}
		} else {
			out.push(newProject, ideaReel)
			for (let n = 1; n <= live; n += 1) pushEntry(n)
		}
	} else {
		for (let n = 1; n <= live; n += 1) pushEntry(n)
	}

	// The next one on the clock, so the cadence is visible before you get there. Two weeks have no use for it. A submitted week has already shipped its closing reel inside Submit, so an unearned one trailing the chain would be a node nobody can ever take. And a forked week ends in a question: a locked node standing between the last of the work and that question reads as a step you have to clear first, when in truth it gates nothing and only belongs to one of the two answers. It comes back the moment the hours earn it.
	if (!submitted && !forked) out.push(milestoneReel(reels + 1))

	const submit = cp({
		// Opens on the week's submit floor – the moment wrapping up becomes a real choice rather than the only road left.
		atHours: floorHours,
		blurb:
			meta.phase === "build" ? "A working video demo or a write-up of what needs changing." : "Submit your project!",
		branch: forked ? "submit" : undefined,
		id: id("submit"),
		kind: "submit",
		title: forked ? "Submit project" : "Submit",
		weekId: meta.id,
	})

	// The fork. Both halves are the last row of the week and the renderer lays them side by side; ordering them keep-then-submit is what puts carrying on on the left, which is the one the trail has been travelling towards.
	if (forked) out.push(entry(live + 1, "keep"), submit)
	else out.push(submit)

	return out
}
