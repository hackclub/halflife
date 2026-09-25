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
    minutes: 4,
    summary: "Ten weeks, two halves, one printer at the end.",
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
    minutes: 3,
    summary: "How hours get counted, and what counts as a session.",
    body: [
      {
        heading: "What a session is",
        paragraphs: [
          "A session is one unbroken block of work on one project. Start the timer when you open the software, stop it when you walk away. If you take a twenty minute break, stop the timer — nobody is checking, but the reviewer can tell when four hours of logged time produced eleven minutes of timelapse.",
        ],
      },
      {
        heading: "Timelapses",
        paragraphs: [
          "Every session needs its hours backed by one of two things: a written journal entry, or a timelapse. You do not need both. Timelapses are recorded on Hack Club's Lapse (lapse.hackclub.com): a screen recording for software, or a camera pointed at the bench. When you finish, publish it on Lapse as public or unlisted, then pick it on the timelapse tab of your entry. Sign in with Lapse once and everything you publish shows up there. One timelapse backs one entry.",
        ],
        list: [
          "Screen recording for CAD, KiCad, and code.",
          "A phone on a stand for soldering and assembly.",
          "Both, if you are switching between them.",
        ],
      },
      {
        heading: "Writing the entry",
        paragraphs: [
          "If you are writing the entry rather than picking a timelapse, the minimum is 200 characters, and images do not count toward it. Say what you did, what broke, and what you are doing next. The best entries read like a note to yourself three weeks from now, because that is exactly who ends up reading them.",
        ],
      },
    ],
  },
  {
    slug: "tiers",
    title: "Funding tiers",
    section: "Money",
    minutes: 3,
    summary: "How much you get, and how hours turn into coins.",
    body: [
      {
        heading: "Picking a tier",
        paragraphs: [
          "You choose a tier when you create a project, and you can change it any time before you submit that week — the tier sits on the project page, and it stays editable until that week is handed in. Tier 1 funds $30 and expects six to eight hours. Tier 2 funds $65 and expects thirteen to fifteen. Tier 3 funds $100 and expects twenty or more.",
          "Those are the funded hours, and they are not the number that lets you submit. A funded hour banks nothing — it has already been spent on your project — so the printer money has to be worked on top of the block. About four banked hours a week (3.76, for an Ender 3 V3 SE) is the least that still ends the season in a machine, which puts the floor at about ten hours on tier 1, seventeen on tier 2 and twenty-four on tier 3. Under that, the week cannot be handed in at that tier; the submit sheet will offer you the tiers your hours do cover.",
          "If you picked one of the starter projects during onboarding, your first week is locked to tier 1. That is on purpose — the starter projects are scoped so a $30 budget is genuinely enough.",
        ],
      },
      {
        heading: "How coins work",
        paragraphs: [
          "The first block of hours pays for the project itself. Everything after that banks at five coins an hour, and every dollar you save against your tier banks as one more coin. Work ten hours on a tier 1 project and you get $30 of funding plus twenty banked coins.",
          "Your tier does not decide which printer you finish with. That is what the banking is for, and it is the same five coins an hour on every tier — the tier only sets how many hours are funded underneath it. Bank a little each week on tier 3 projects and you finish with the cheapest machine; bank hard on tier 1 projects and you finish with the most expensive one.",
        ],
      },
    ],
  },
  {
    slug: "submitting",
    title: "Submitting a week",
    section: "Shipping",
    minutes: 4,
    summary: "The checklist reviewers actually use.",
    body: [
      {
        heading: "Design weeks",
        paragraphs: [
          "Three things: the files, the bill of materials, and a closing reel. Files means source files, not exports — a PDF of a schematic is not a schematic. The BOM needs a real vendor and a real price per line, and we ask for a screenshot of the cart so the numbers are checkable.",
        ],
        list: [
          "Every file in the checklist attached.",
          "BOM total inside your tier, or a note explaining why not.",
          "A 30 second reel walking through the final design.",
        ],
      },
      {
        heading: "Build weeks",
        paragraphs: [
          "One video, thirty to sixty seconds, of the project working, with your voice explaining what it does. If it does not work, that is still a valid submission — record what happens instead, and write up what needs to change. Reviewers pass honest failures and fail silent ones.",
        ],
      },
    ],
  },
  {
    slug: "reels",
    title: "Making a reel",
    section: "Shipping",
    minutes: 2,
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
