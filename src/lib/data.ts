import { EXAMPLE_JOURNAL_URL } from "./routes"
import type { DocArticle } from "./types"

/**
 * Reference content, written rather than recorded.
 *
 * What is left in this file is the 5 docs pages, and they belong here: they are editorial copy with no database behind them, and putting them in Postgres would mean a migration to fix a typo. Everything else that used to live here – the reels, the journal feed, the shop shelves, the leaderboard, the signed- in user – was scaffolding for a front end with no server, and now comes from one.
 */

export const DOCS: DocArticle[] = [
	{
		body: [
			{
				heading: "The shape of the program",
				paragraphs: [
					"Half Life runs for 10 weeks. The first 5 are design weeks: each one has a theme, and you spend it designing a project around that theme. The second 5 are build weeks, in the same order – on week 6 you build the PCB you designed on week 1, on week 7 the CAD part from week 2, and so on.",
					"You are not designing 5 things you will never make. Everything you draw in the first half arrives as real parts in the second.",
				],
			},
			{
				heading: "Checkpoints",
				list: [
					"Journal checkpoints unlock at zero hours and close at the hour target.",
					"Reels are 30 seconds minimum and can be filmed on a phone.",
					"Submit gates are reviewed by a human, usually within two days.",
				],
				paragraphs: [
					"Each week is a chain of checkpoints. You cannot skip one – the next puck stays sand-coloured until the one before it is done. Most checkpoints are either a journal block (keep logging sessions until the week hits 10 tracked hours) or a reel (a short video showing where you got to).",
					"The week ends on a submit gate. Design weeks ask for your files, a bill of materials, and a closing reel. Build weeks ask for a 30 to 60 second video of the thing working.",
				],
			},
			{
				heading: "What you get",
				paragraphs: [
					"Every project gets parts funding for its tier: $30, $65, or $100; higher tiers require more hours to earn funding. Working more time on your project beyond your tier earns coins, which you can spend in the shop. That is, once the funding for your chosen tier has been achieved, every extra approved hour earns 5 coins.",
					"If you finish all 10 weeks then a 3D printer is shipped to you. You can change your printer at any time: pick it as your goal and work toward it through the season. Earn enough coins every week and the entry-level printer is guaranteed; go further and you can aim for bigger prizes.",
				],
			},
		],
		section: "Start here",
		slug: "how-it-works",
		summary: "What's all this then?",
		title: "How Half Life works",
	},
	{
		body: [
			{
				heading: "What a session is",
				paragraphs: [
					"A session is one sitting of work on one project: you sit down, work, and stop. Every session gets its own journal entry on the map, with the hours that sitting took – ideally logged the same day. Log it while you still remember what you did – an entry written a week later is a guess, and it reads like one.",
					"Your hours are only as good as the evidence behind them. Reviewers approve hours by reading your entries and watching your timelapses, so an entry that says what happened, shows it, and claims a believable amount of time is the whole job.",
				],
			},
			{
				heading: "Two ways to back your hours",
				paragraphs: [
					"Each session is backed by a written entry, a Lapse timelapse, or both together: pick timelapses on the entry's Timelapse tab, write on the Journal tab, and everything you pick and write lands on the same entry. Either one alone is enough, and together they add.",
					"Type the hours the timelapses don't cover (9.5 means nine and a half): a 5-hour recording plus 2 additional hours logs 7. Leave the box at 0 if the recording covers it all.",
				],
			},
			{
				heading: "Recording with Lapse",
				list: [
					"Screen recording for CAD, KiCad, and firmware.",
					"A phone on a stand, pointed at the bench, for soldering and assembly.",
					"Both at once when you are switching between the screen and the bench.",
				],
				paragraphs: [
					"Lapse (lapse.hackclub.com) is Hack Club's timelapse app, and it is the only one the platform takes. Start a recording when you sit down to work and it captures your screen or your camera while you go.",
					"You can pause or stop a timelapse at any time. Pause it when you step away – to eat, to answer a message, to wait for a print – and pick it back up when you return, so the recording, and the hours it counts, are only the time you were actually working.",
					"When the session is done, publish the timelapse on Lapse as Unlisted or Public. A private timelapse cannot be watched by a reviewer, so it cannot back any hours, and it will not show up to pick. Then open the entry on your map, switch to the Timelapse tab, sign in with Lapse if it asks (a sign-in lasts about a month), and pick it. Each timelapse can back one entry only.",
				],
			},
			{
				heading: "The rules a written entry has to meet",
				list: [
					"At least 200 characters of writing. Images do not count toward it.",
					"One image for every additional hour you declare, and never fewer than two: 2 additional hours need two screenshots, however long the timelapses run.",
					"Markdown works – headings, bold, lists, code and links. Images go in with ![what it shows](link), right where they belong in the story.",
				],
				paragraphs: ["The editor checks these before it will let you save, and tells you exactly what is missing."],
			},
			{
				heading: "Writing an entry worth reading",
				link: { href: EXAMPLE_JOURNAL_URL, label: "See an example journal" },
				list: [
					'A headline that says what happened: "Got the screen to work!!" beats "Day 4".',
					"What you set out to do, and why it was hard. The problem is half the story.",
					"How you got there: what you looked up, what you tried, what broke, and what finally fixed it. Link the datasheet, repo or forum thread that helped.",
					"Pictures of the work in progress – screenshots of the schematic or model, photos of the board – placed next to the sentence they prove.",
					"A one-line tl;dr at the end, so a reviewer skimming a week of entries knows what each one was.",
					"What is next, so the following session starts where this one stopped.",
				],
				paragraphs: [
					"The best entries read like a note to yourself three weeks from now, because that is exactly who ends up reading them – you, and a reviewer. Tell the story of the session in the order it happened, and be specific: the part number, the error message, the file you changed. A good entry has these parts:",
				],
			},
			{
				heading: "Make it yours",
				paragraphs: [
					"Write your entries yourself, in your own words. Reviewers are reading for your process – the dead ends as much as the wins – and a generated summary does not show one. If writing feels like a chore, talk through the session into a voice memo or a quick video while it is fresh, then write the entry from that.",
				],
			},
			{
				heading: "When an entry is final",
				paragraphs: [
					"You can edit an entry while its week is still open – its words, its hours, and which timelapses back it. Once you submit the week, its entries are what the reviewer is reading, so they cannot be edited until you unsubmit; and once a reviewer has set the hours on an entry, that entry is final.",
				],
			},
		],
		section: "Start here",
		slug: "journalling",
		summary:
			"What counts as a session, how to write an entry a reviewer can check, and how Lapse timelapses back your hours.",
		title: "Journalling and timelapses",
	},
	{
		body: [
			{
				heading: "The three tiers",
				list: [
					"Tier 1: $30, for a focused build like your first board.",
					"Tier 2: $65, for a board with more going on.",
					"Tier 3: $100, for an ambitious build.",
				],
				paragraphs: [
					"Every project gets funding for its parts, and your tier sets how much. Pick the one that fits the size of what you want to build.",
				],
			},
			{
				heading: "Picking a tier",
				paragraphs: [
					"You pick a tier when you create a project. You can change it until your design week is approved. A reviewer sets the final tier when they approve it. Starter projects are always tier 1.",
				],
			},
			{
				heading: "Time to submit",
				list: ["Tier 1: 6 hours.", "Tier 2: 13 hours.", "Tier 3: 20 hours."],
				paragraphs: [
					"Bigger builds take longer to design well, so each tier has a minimum amount of design time before you can submit:",
				],
			},
			{
				heading: "Coins",
				list: [
					"Design week: your tier's funded hours pay for your parts and earn no coins. Past them, approved time banks toward your printer goal – how much depends on the printer you picked – and anything beyond that is yours to spend.",
					"Build week: nothing is funded, so every hour earns coins: the first 5 bank toward your printer goal, and the rest are yours to spend.",
					"Each submission is capped at 250 spendable coins (50 hours).",
					"Ship a theme (design and build both approved): 25 bonus coins to spend.",
				],
				paragraphs: [
					"Coins track how far you go past what your project needs. The hours your tier funds pay for parts and earn no coins – coins are earned at 5 per hour, but only after that tier's funding is achieved. They fill your printer goal before the rest is yours to spend in the shop.",
				],
			},
			{
				heading: "How do coins work?",
				paragraphs: [
					"Each week, you'll recieve coins from your approved projects. You can spend those coins in the shop OR on your printer!",
				],
			},
		],
		section: "Funding",
		slug: "tiers",
		summary: "What each tier covers, how much design time it asks for, and how coins work.",
		title: "Funding tiers",
	},
	{
		body: [
			{
				heading: "What shipping means",
				paragraphs: [
					"Shipping is making your project something other people can open, understand and rebuild. A project that only exists on your laptop has not shipped, and a reviewer cannot approve what they cannot see. The week's work lives in a public repo, and the repo is the first thing a reviewer opens.",
				],
			},
			{
				heading: "AI Usage, Project Quality, and Originality",
				list: [
					"You may not use AI to generate any graphics used in the final github repo.",
					"You may use AI to help with coding, up to ~30% of code can be generated, the majority should still be your own work.",
					"Journals and your README cannot be written with the help of AI.",
					"Your project should be polished, something you'd be proud to show to others, and something that you can potentially sell as a product!",
					"Copied designs, stolen project files, and more will result in a rejection and potential ban from Half life and Hack Club as a whole",
					"Projects should be original, with most parts being designed by you. That means depending on the week, you cannot for example buy a kit, or use only premade modules for a project",
				],
				paragraphs: ["Failure to meet the below expectations may result in your project rejected"],
			},
			{
				heading: "Your repo",
				list: [
					"Every week: a public repo, with a README that has photos in it.",
					"PCB week: board and schematic source files (.kicad_pcb, .kicad_sch), and firmware for the board (Arduino .ino, C/C++, MicroPython or CircuitPython). Recommended: Gerbers (a .zip is fine) and a bom.csv.",
					"CAD week: editable CAD files (.step, .f3d, .fcstd, .scad). Recommended: printable models (.stl, .3mf).",
					"Music week: a schematic (KiCad, Logisim or Digital). Recommended: firmware.",
					"Displays week: firmware or code. Recommended: a schematic.",
					"Breadboard computer week: a schematic (KiCad, Logisim or Digital).",
				],
				paragraphs: [
					"The submit sheet checks your repo before it lets you submit. A missing README, a README with no photos, or a missing required file blocks the submit and tells you what to add. Recommended files are flagged but never block.",
				],
			},
			{
				heading: "A README worth reading",
				list: [
					"What it is, and why you made it.",
					"How it works: how the parts fit together.",
					"Photos and screenshots: the schematic, the board layout, the 3D model, and the real thing once it exists.",
					"A wiring diagram, if anything is wired by hand.",
					"The bill of materials, as a table with links to where each part is bought.",
				],
				paragraphs: [
					"A folder of files and two sentences is not documentation. Write the README for someone who has never heard of your project and wants to build one:",
				],
			},
			{
				heading: "Source files, not exports",
				paragraphs: [
					"Upload the files someone would need to change your design, not just look at it. A PDF of a schematic is not a schematic, and an STL is not a CAD model. Keep the repo organised in folders, with firmware, libraries and anything you referenced alongside it.",
				],
			},
			{
				heading: "Handing in a design week",
				list: [
					"Your bill of materials, with a real vendor and a real price on every line.",
					"Screenshots of your cart with the total visible, one per vendor if the order is split, so the total can be checked.",
					"Your tier. Your hours have to reach that tier's minimum; the sheet shows which tiers they cover.",
					"A closing reel: pan across the schematic, the layout and the render, and talk over it.",
				],
				paragraphs: ["After the repo check, the submit sheet asks for three things:"],
			},
			{
				heading: "Handing in a build week",
				paragraphs: [
					"One demo video: point the camera at the thing, turn it on, and talk over it. Then say whether it works. If it does not, that is still a valid submission. Record what happens, and write up what went wrong and what needs to change. Reviewers pass honest failures and fail silent ones.",
					"Anything you changed while building – the firmware, the model, a fix to the board – goes in your journal and in the repo too.",
				],
			},
			{
				heading: "Before your first submit",
				paragraphs: [
					"You need at least one logged session for the week, and a cover image on the project. The cover is what your project's card and the review queue show, so it has to be a photo or screenshot of the project itself – not a logo or a stock photo.",
					"Your Hack Club identity has to be verified at identity.hackclub.com before you can buy anything in the shop – you can explore, journal and submit without it.",
				],
			},
			{
				heading: "What gets a week sent back",
				list: [
					"The README does not explain the project, or has no photos.",
					"Source files are missing, or only exports are there.",
					"The journal does not back the hours claimed.",
					"The BOM does not match the cart, or has no real prices.",
				],
				paragraphs: [
					"Reviewers can approve a week, send it back with changes to make, or reject it. A week sent back can be fixed and submitted again. The usual reasons:",
				],
			},
		],
		section: "Shipping",
		slug: "submitting",
		summary: "What your repo needs, what the submit sheet asks for, and what reviewers check.",
		title: "Shipping a week",
	},
	{
		body: [
			{
				heading: "The format",
				paragraphs: [
					"Vertical, thirty to sixty seconds, filmed on whatever you have. Say what it is in the first five seconds. Show the thing, not your face. One idea per reel.",
				],
			},
			{
				heading: "Where they go",
				paragraphs: [
					"Reels land in the Doomscroller, which is the feed on the right of your home screen and the main way anyone else in the program finds out what you are making. Likes and comments do nothing for your progress and everything for your mood.",
				],
			},
		],
		section: "Shipping",
		slug: "reels",
		summary: "Thirty seconds, one idea, no editing required.",
		title: "Making a reel",
	},
]
