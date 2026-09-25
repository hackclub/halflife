import type { DocArticle } from "./types"

/**
 * Reference content, written rather than recorded.
 *
 * What is left in this file is the five docs pages, and they belong here: they
 * are editorial copy with no database behind them, and putting them in Postgres
 * would mean a migration to fix a typo. Everything else that used to live here
 * — the reels, the journal feed, the shop shelves, the leaderboard, the signed-
 * in user — was scaffolding for a front end with no server, and now comes from
 * one.
 */

export const DOCS: DocArticle[] = [
  {
    slug: "how-it-works",
    title: "How Half Life works",
    section: "Start here",
    summary: "What's all this then?",
    body: [
      {
        heading: "The shape of the program",
        paragraphs: [
          "Half Life runs for ten weeks. The first five are design weeks: each one has a theme, and you spend it designing a project around that theme. The second five are build weeks, in the same order — on week six you build the PCB you designed on week one, on week seven the CAD part from week two, and so on.",
          "You are not designing five things you will never make. Everything you draw in the first half arrives as real parts in the second.",
        ],
      },
      {
        heading: "Checkpoints",
        paragraphs: [
          "Each week is a chain of checkpoints. You cannot skip one — the next puck stays sand-coloured until the one before it is done. Most checkpoints are either a journal block (keep logging sessions until the week hits ten tracked hours) or a reel (a short video showing where you got to).",
          "The week ends on a submit gate. Design weeks ask for your files, a bill of materials, and a closing reel. Build weeks ask for a 30 to 60 second video of the thing working.",
        ],
        list: [
          "Journal checkpoints unlock at zero hours and close at the hour target.",
          "Reels are 30 seconds minimum and can be filmed on a phone.",
          "Submit gates are reviewed by a human, usually within two days.",
        ],
      },
      {
        heading: "What you get",
        paragraphs: [
          "Every project is funded up to its tier — $30, $65 or $100 — paid straight onto a card you can spend at real vendors. Hours beyond the funded block bank as coins at five an hour, and coins buy things in the shop.",
          "Finish all ten weeks and a printer is yours, shipped to you. Which one is up to you: you pick a goal, and the coins you bank buy it. Hit the hours every week and the cheapest machine is guaranteed — bank faster and you can aim higher.",
        ],
      },
    ],
  },
  {
    slug: "journalling",
    title: "Journalling and timelapses",
    section: "Start here",
    summary:
      "What counts as a session, how to write an entry a reviewer can check, and how Lapse timelapses back your hours.",
    body: [
      {
        heading: "What a session is",
        paragraphs: [
          "A session is one sitting of work on one project: you sit down, work, and stop. Every session gets its own journal entry on the map, with the hours that sitting took — ideally logged the same day. Log it while you still remember what you did — an entry written a week later is a guess, and it reads like one.",
          "Your hours are only as good as the evidence behind them. Reviewers approve hours by reading your entries and watching your timelapses, so an entry that says what happened, shows it, and claims a believable amount of time is the whole job.",
        ],
      },
      {
        heading: "Two ways to back your hours",
        paragraphs: [
          "Each session is backed by one of two things: a written entry, or a Lapse timelapse. You pick one on the entry's Journal or Timelapse tab; you never need both.",
          "A written entry needs its hours typed in (9.5 means nine and a half). A timelapse brings its own: the time Lapse recorded becomes the session's hours, so there is nothing to type.",
        ],
      },
      {
        heading: "Recording with Lapse",
        paragraphs: [
          "Lapse (lapse.hackclub.com) is Hack Club's timelapse app, and it is the only one the platform takes. Start a recording when you sit down to work and it captures your screen or your camera while you go.",
          "You can pause or stop a timelapse at any time. Pause it when you step away — to eat, to answer a message, to wait for a print — and pick it back up when you return, so the recording, and the hours it counts, are only the time you were actually working.",
          "When the session is done, publish the timelapse on Lapse as Unlisted or Public. A private timelapse cannot be watched by a reviewer, so it cannot back any hours, and it will not show up to pick. Then open the entry on your map, switch to the Timelapse tab, sign in with Lapse if it asks (a sign-in lasts about a month), and pick it. Each timelapse can back one entry only.",
        ],
        list: [
          "Screen recording for CAD, KiCad, and firmware.",
          "A phone on a stand, pointed at the bench, for soldering and assembly.",
          "Both at once when you are switching between the screen and the bench.",
        ],
      },
      {
        heading: "The rules a written entry has to meet",
        paragraphs: ["The editor checks these before it will let you save, and tells you exactly what is missing."],
        list: [
          "At least 200 characters of writing. Images do not count toward it.",
          "One image for every hour you claim, and never fewer than two: a 4.5-hour session needs five.",
          "Markdown works — headings, bold, lists, code and links. Images go in with ![what it shows](link), right where they belong in the story.",
        ],
      },
      {
        heading: "Writing an entry worth reading",
        paragraphs: [
          "The best entries read like a note to yourself three weeks from now, because that is exactly who ends up reading them — you, and a reviewer. Tell the story of the session in the order it happened, and be specific: the part number, the error message, the file you changed. A good entry has these parts:",
        ],
        list: [
          'A headline that says what happened: "Got the screen to work!!" beats "Day 4".',
          "What you set out to do, and why it was hard. The problem is half the story.",
          "How you got there: what you looked up, what you tried, what broke, and what finally fixed it. Link the datasheet, repo or forum thread that helped.",
          "Pictures of the work in progress — screenshots of the schematic or model, photos of the board — placed next to the sentence they prove.",
          "A one-line tl;dr at the end, so a reviewer skimming a week of entries knows what each one was.",
          "What is next, so the following session starts where this one stopped.",
        ],
      },
      {
        heading: "Make it yours",
        paragraphs: [
          "Write your entries yourself, in your own words. Reviewers are reading for your process — the dead ends as much as the wins — and a generated summary does not show one. If writing feels like a chore, talk through the session into a voice memo or a quick video while it is fresh, then write the entry from that.",
        ],
      },
      {
        heading: "When an entry is final",
        paragraphs: [
          "You can edit an entry while its week is still open. Once you submit the week, its entries are what the reviewer is reading, so they cannot be edited until you unsubmit; and once a reviewer has set the hours on an entry, that entry is final.",
        ],
      },
    ],
  },
  {
    slug: "tiers",
    title: "Funding tiers",
    section: "Money",
    summary: "How much each tier funds, and how your hours turn into coins.",
    body: [
      {
        heading: "The three tiers",
        paragraphs: [
          "Every project gets money for parts. Your tier sets how much. The first hours of a design week are what that money pays for.",
        ],
        list: [
          "Tier 1: $30. Covers your first 6 hours.",
          "Tier 2: $65. Covers your first 13 hours.",
          "Tier 3: $100. Covers your first 20 hours.",
        ],
      },
      {
        heading: "Picking a tier",
        paragraphs: [
          "You pick a tier when you create a project. You can change it until your design week is approved. A reviewer sets the final tier when they approve it. Starter projects are always tier 1.",
        ],
      },
      {
        heading: "Hours to submit",
        paragraphs: [
          "A design week needs more hours than its tier covers. The extra hours go toward your printer. These are the minimums:",
        ],
        list: ["Tier 1: 10 hours.", "Tier 2: 17 hours.", "Tier 3: 24 hours."],
      },
      {
        heading: "Hours become coins",
        paragraphs: ["One hour of approved work is worth 5 coins. One coin is worth $1."],
        list: [
          "Design week: the hours your tier covers pay for parts, not coins.",
          "Design week: the hours after that bank toward your printer. How many depends on the printer you picked.",
          "Design week: anything beyond that is coins you can spend.",
          "Build week: the first 5 hours bank toward your printer. The rest are coins you can spend.",
          "Ship a theme (design and build both approved): 25 bonus coins to spend.",
        ],
      },
      {
        heading: "Two kinds of coins",
        paragraphs: [
          "Banked coins can only buy a printer. Spendable coins buy anything in the shop, printers included. You unlock the printer by shipping all five themes.",
        ],
      },
    ],
  },
  {
    slug: "submitting",
    title: "Shipping a week",
    section: "Shipping",
    summary: "What your repo needs, what the submit sheet asks for, and what reviewers check.",
    body: [
      {
        heading: "What shipping means",
        paragraphs: [
          "Shipping is making your project something other people can open, understand and rebuild. A project that only exists on your laptop has not shipped, and a reviewer cannot approve what they cannot see. The week's work lives in a public GitHub repo, and the repo is the first thing a reviewer opens.",
        ],
      },
      {
        heading: "Your repo",
        paragraphs: [
          "The submit sheet checks your repo before it lets you hand in. A missing README, a README with no photos, or a missing required file blocks the submit and tells you what to add. Recommended files are flagged but never block.",
        ],
        list: [
          "Every week: a public GitHub repo, with a README that has photos in it.",
          "PCB week: board and schematic source files (.kicad_pcb, .kicad_sch). Recommended: Gerbers (a .zip is fine) and a bom.csv.",
          "CAD week: editable CAD files (.step, .f3d, .fcstd, .scad). Recommended: printable models (.stl, .3mf).",
          "Music week: a schematic (KiCad, Logisim or Digital). Recommended: firmware.",
          "Displays week: firmware or code. Recommended: a schematic.",
          "Breadboard computer week: a schematic (KiCad, Logisim or Digital).",
        ],
      },
      {
        heading: "A README worth reading",
        paragraphs: [
          "A folder of files and two sentences is not documentation. Write the README for someone who has never heard of your project and wants to build one:",
        ],
        list: [
          "What it is, and why you made it.",
          "How it works: how the parts fit together.",
          "Photos and screenshots: the schematic, the board layout, the 3D model, and the real thing once it exists.",
          "A wiring diagram, if anything is wired by hand.",
          "The bill of materials, as a table with links to where each part is bought.",
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
        paragraphs: ["After the repo check, the submit sheet asks for three things:"],
        list: [
          "Your bill of materials, with a real vendor and a real price on every line.",
          "Screenshots of your cart with the total visible, one per vendor if the order is split, so the total can be checked.",
          "Your tier. Your hours have to reach that tier's minimum; the sheet shows which tiers they cover.",
          "A closing reel: pan across the schematic, the layout and the render, and talk over it.",
        ],
      },
      {
        heading: "Handing in a build week",
        paragraphs: [
          "One demo video: point the camera at the thing, turn it on, and talk over it. Then say whether it works. If it does not, that is still a valid submission. Record what happens, and write up what went wrong and what needs to change. Reviewers pass honest failures and fail silent ones.",
          "Anything you changed while building — the firmware, the model, a fix to the board — goes in your journal and in the repo too.",
        ],
      },
      {
        heading: "Before your first submit",
        paragraphs: [
          "You need at least one logged session for the week, and your Hack Club identity has to be verified at identity.hackclub.com. You can explore and journal before verifying; only submitting waits for it.",
        ],
      },
      {
        heading: "What gets a week sent back",
        paragraphs: [
          "Reviewers can approve a week, send it back with changes to make, or reject it. A week sent back can be fixed and handed in again. The usual reasons:",
        ],
        list: [
          "The README does not explain the project, or has no photos.",
          "Source files are missing, or only exports are there.",
          "The journal does not back the hours claimed.",
          "The BOM does not match the cart, or has no real prices.",
          "Work that is not yours: copied designs, or a README or journal written by AI.",
        ],
      },
    ],
  },
  {
    slug: "reels",
    title: "Making a reel",
    section: "Shipping",
    summary: "Thirty seconds, one idea, no editing required.",
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
  },
]
