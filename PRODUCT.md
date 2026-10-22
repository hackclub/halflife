# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Teenagers in Hack Club's Half Life programme, many of whom have never built hardware. They use the logged-in platform most days for ten weeks, often on a phone in a bedroom or a school laptop. Staff (reviewers, admins, fulfillers) use a separate console to review and approve work.

## Product Purpose

Half Life is Hack Club's ten-week hardware programme. Each of the first five weeks has a theme – PCBs, CAD, Music, Displays, Breadboard Computer – and participants design a project in that theme, then build it in the matching build week (weeks 6-10). They journal their hours and post reels as they go, and approved work earns coins toward a 3D printer. Success is a participant shipping real hardware every theme.

## Positioning

A Duolingo-style trail of checkpoints through real hardware work: each week is a design-then-build cycle with journals, reels and reviewer approval, funded by tier, ending on the printer the participant is saving for.

## Operating Context

- The trail (`/dashboard`) is the home: every week's checkpoints on one continuous path.
- First checkpoint of a week asks about experience; beginners (first time / a little) are shown starter projects.
- Starter projects are finished, Tier 1 builds with step-by-step guides. Taking one locks the tier request to 1.
- Week 4 (Displays) starter projects are seven display guides: 5mm LEDs, LED filament, 7-segment displays, NeoPixels, LED matrices, OLED screens and TFT screens.
- Hardware context the guides assume: XIAO RP2040 / ESP32-C3 or Raspberry Pi Pico, KiCad for PCBs, Arduino or MicroPython/CircuitPython firmware.

## Capabilities and Constraints

- Next.js app with route groups: `(site)` landing, `(platform)/(app)` participant platform, `(platform)/(ops)` staff console.
- Starter project data lives in `src/lib/config/onboarding.ts` (`STARTER_PROJECTS`); renders in `public/art/starters/`.
- Themes and weeks live in `src/lib/config/program.ts`.
- Participants submit projects; reviewers approve designs and builds.

## Brand Commitments

- Always written "Hack Club".
- Say "submit", never "hand in".
- Voice is casual, upbeat and encouraging, talking straight to "you" ("Anyone can do hardware.").
- Illustration is the programme's own (fox and gato characters, theme paintings). Never AI- or code-drawn illustration.

## Evidence on Hand

- Week theme paintings: `public/art/weeks/` (PCB, cad, music, display, breadboard).
- Starter renders: `public/art/starters/` (starbie, merbl, midi).
- Display guide content and 26 freely licensed Wikimedia Commons photos (credited) from the "A Beginner's Guide to Displays" doc.
- Reference Hack Club guides the voice follows: Pathfinder, Hermes, Blueprint MIDI, Starbie, MIDI keypad.

## Product Principles

1. Anyone can do hardware: every page should lower the barrier for a first-timer.
2. Show the real thing: real builds, real photos, real parts – nothing invented.
3. A path, not a dashboard: progress reads as a journey through ten weeks.
4. Make it yours: guides are starting points, and submissions must be the participant's own design.
