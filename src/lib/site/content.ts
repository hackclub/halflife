/**
 * Every word and fact on the page. Copy is taken from the approved comp (Figma "landing page (claude)", node 275:8). Nothing here is invented: program claims – dates, prize list, funding cap, community size – are the comp's own.
 *
 * Artwork is imported rather than named by path. A string path is a promise the build cannot check and the cache cannot see through: `/art/build.png` stays the same URL when the file behind it changes, so Next's optimizer goes on serving what it cached under that key – four hours by default – and a replaced picture does not appear. An import is resolved at build time, so a missing file is a build error rather than a 404 nobody notices, and the URL carries a hash of the file's own bytes: replace the art and the URL changes with it, which invalidates every cache between here and the browser without anyone having to remember to clear one.
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

const BRAND = {
	/**
	 * Under the email field. The one line here that is not the comp's: it was asked for directly, and it is the two things someone hesitating over the field wants settled before they type. Lowercase to match the tagline above it; en dash because 13-18 is a range.
	 */
	eligibility: "teens 13-18. no experience necessary. free to participate.",
	name: "Half Life",
	tagline: "become a hardware expert in 10 weeks, get a 3D printer",
} as const

interface DesignWeek {
	/**
	 * The artwork behind this pairing, as a path under `public/`. Optional on the same terms as a `BuildCard`'s photo: a week without one falls back to the drawn slot, so the five fill in one week at a time. Both layouts read it from here, so a new picture lands on the stage and in the stacked column from one edit.
	 *
	 * Week 3 has none yet – `public/art/weeks` ships PCB, cad, display and breadboard, and nothing for music.
	 */
	art?: string
	subject: string
	week: string
}

/** Week 1 leads at display scale; weeks 2-5 sit beneath it. */
const DESIGN_WEEKS: { lead: DesignWeek; rest: DesignWeek[] } = {
	lead: { art: "/art/weeks/PCB.png", subject: "PCBs", week: "week 1" },
	rest: [
		{ art: "/art/weeks/cad.png", subject: "CAD", week: "week 2" },
		{ subject: "music", week: "week 3" },
		{ art: "/art/weeks/display.png", subject: "displays", week: "week 4" },
		{
			art: "/art/weeks/breadboard.png",
			subject: "breadboard logic",
			week: "week 5",
		},
	],
}

interface Step {
	/**
	 * The step's artwork, on the same terms as a `DesignWeek`'s `art` and a `BuildCard`'s `photo`: an optional path, with `slot` drawn as the fallback
	 * while a step is still waiting for its picture. `slot` stays on a step that
	 * has its art – it is the in-source record of the footprint the comp drew.
	 */
	art?: StaticImageData
	caption?: string
	id: string
	/** Slot the user drops a real photo into. */
	slot?: { label: string; ratio: string }
	title: string
}

/** Exactly four, in comp order: design, funding, build, printer. The
 * arity is load-bearing – `process.tsx` destructures these positionally
 *  and gives each one its own plate. */
const STEPS: [Step, Step, Step, Step] = [
	{
		art: allWeeksArt,
		id: "design",
		title: "spend 5 weeks designing 5 projects",
	},
	{
		art: getFundingArt,
		caption: "up to $100 per project!",
		id: "funding",
		slot: { label: "order flow", ratio: "736 × 155" },
		title: "get funding and order your parts!",
	},
	{
		art: buildArt,
		id: "build",
		slot: { label: "build photo", ratio: "736 × 269" },
		title: "then spend 5 weeks building your projects!",
	},
	{
		art: prizesArt,
		id: "printer",
		slot: { label: "prize lineup", ratio: "736 × 269" },
		title: "get a 3D printer!",
	},
]

interface Aside {
	body: string
	id: string
	title: string
}

/** Exactly two; each is placed at its own offset on the process band. */
const ASIDES: [Aside, Aside] = [
	{
		body: "Make videos, posts, and blogs about your Half Life projects! If they hit our virality threshold, you'll earn extra prizes like plushies, drawing tablets, and iPads!",
		id: "viral",
		title: "earn more prizes by going viral!",
	},
	{
		body: "Hack Club has a community of over 100,000 teenagers from around the globe, who all love building projects and learning how to build projects. Join now at hackclub.com/slack!",
		id: "community",
		title: "there are thousands of us!",
	},
]

interface BuildCard {
	credit: string
	id: string
	/** Names the project. Not drawn -- it is the photograph's alt text. */
	label: string
	/**
	 * The project photograph, as a path under `public/`. Optional on purpose: a card without one falls back to the drawn slot, so the belt fills up one project at a time instead of needing the whole set before it renders.
	 */
	photo?: StaticImageData
	/**
	 * ── PUT THE GITHUB LINK HERE ────────────────────────────────────────── Full URL to the project's repo, e.g. repo: "https://github.com/you/your-project", Optional: a card left empty here simply shows no button, so the repos can be filled in one project at a time.
	 */
	repo?: string
	/** The drawn footprint, standing in until `photo` lands. */
	slot: { label: string; ratio: string }
}

const BUILD_CARDS: BuildCard[] = [
	{
		credit: "by Joshua, 18, from Quebec",
		id: "hexapod",
		label: "Hexapod robot",
		photo: hexapodPhoto,
		repo: "https://github.com/Josh4minee/HEX-B12.V1",
		slot: { label: "project photo", ratio: "329 x 377" },
	},
	{
		credit: "by Dani, 17, from New York",
		id: "jukebox",
		label: "Minecraft Jukebox",
		photo: jukeboxPhoto,
		repo: "https://github.com/danieliscrazy/Jukebox",
		slot: { label: "project photo", ratio: "329 x 377" },
	},
	{
		credit: "by Nirvaan, 14, from New Jersey",
		id: "macropad",
		label: "12-key Macropad",
		photo: macropadPhoto,
		repo: "https://github.com/OakTreeWC/12KEMPV2.1",
		slot: { label: "project photo", ratio: "329 x 377" },
	},
	{
		credit: "by Archit, 15, from Australia",
		id: "flightcontroller",
		label: "Rocket Flight Controller",
		photo: flightControllerPhoto,
		repo: "https://github.com/codinga593/IRIS",
		slot: { label: "project photo", ratio: "329 x 377" },
	},
	{
		credit: "by Cyao, 18, from France",
		id: "icepi",
		label: "Icepi Zero FPGA Devboard",
		photo: icepiPhoto,
		repo: "https://github.com/cheyao/icepi-zero",
		slot: { label: "project photo", ratio: "329 x 377" },
	},
]

interface Faq {
	a: string
	q: string
}

const FAQS: Faq[] = [
	{
		a: "Half Life is for teenagers 13-18 (inclusive)! Whether you've never touched hardware before or you're a multiplexing master, Half Life is your place to become a well-rounded hardware expert.",
		q: "Who is this for?",
	},
	{
		a: "That's okay! We have guided projects and hardware experts to help you out. Half Life is for beginners, experts, and all the levels in between.",
		q: "I don't know hardware!",
	},
	{
		a: "Yep! Hack Club programs are free to participate in. We provide funding for hardware projects and all prizes (like 3D printers) are free! We do not cover customs costs.",
		q: "Is this free?",
	},
	{
		a: "Half Life is running for 10 weeks! September 14th to October 4th will be warmup weeks 1-3 (where you can submit any hardware project and get funding from up $100), and then PCB Week will start!",
		q: "When does this start?",
	},
	{
		a: "Hack Club is a 501(c)(3) nonprofit that helps teenagers around the world build technical projects and go on awesome adventures!",
		q: "What's Hack Club?",
	},
	{
		a: "Up to $100 of funding per project, a 3D printer for finishing all ten weeks, and extra prizes (like plushies, drawing tablets, and iPads) for going above and beyond.",
		q: "What do I get?",
	},
]

/**
 * The one group shot under "here's what you'll make!" – every project in a single frame, where the comp scattered five separate prints. The art is not shipped; the hero shows its themed stand-ins instead.
 */
const FOOTER_COLUMNS = [
	{
		heading: "Half Life",
		links: [
			{ href: "#how-it-works", label: "How it works" },
			{ href: "#what-can-i-build", label: "What you can build" },
			{ href: "#faq", label: "FAQ" },
			{ href: "#signup", label: "Sign up" },
		],
	},
	{
		heading: "Hack Club",
		links: [
			{ href: "https://hackclub.com", label: "hackclub.com" },
			{ href: "https://hackclub.com/philosophy", label: "Philosophy" },
			{ href: "https://hackclub.com/team", label: "Team" },
			{ href: "https://hackclub.com/donate", label: "Donate" },
		],
	},
	{
		heading: "Community",
		links: [
			{ href: "https://hackclub.com/slack", label: "Slack" },
			{ href: "https://github.com/hackclub", label: "GitHub" },
			{ href: "https://hackclub.com/conduct", label: "Conduct" },
		],
	},
] as const

export {
	ASIDES,
	type Aside,
	BRAND,
	BUILD_CARDS,
	type BuildCard,
	DESIGN_WEEKS,
	type DesignWeek,
	FAQS,
	type Faq,
	FOOTER_COLUMNS,
	STEPS,
	type Step,
}
