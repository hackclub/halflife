import type { Metadata, Viewport } from "next"
import { Open_Sans, Ubuntu } from "next/font/google"
import localFont from "next/font/local"
import "./globals.css"

/**
 * The comp's own display face (Figma 275:8), self-hosted from `public/fonts`.
 * It ships a single 400 brush weight whose strokes overhang their advances —
 * 'I' carries 0.52em of ink on a 0.32em advance — so it is already heavy and
 * must never be synthetically emboldened. See `.font-hand` in globals.css.
 *
 * Licence: free, per `public/fonts/Read me.txt`, with the author asking for a
 * donation to charity for commercial use.
 */
const masterpiece = localFont({
  src: "../../../public/fonts/Masterpiece.ttf",
  variable: "--font-masterpiece",
  weight: "400",
  style: "normal",
  display: "swap",
})

const openSans = Open_Sans({
  subsets: ["latin"],
  variable: "--font-open-sans",
  display: "swap",
})

/**
 * Every heading and every line of display type on the page, and the tagline
 * it was originally brought in for.
 *
 * It replaced Urbanist, which was the third family here and is now gone: the
 * page is Ubuntu and Open Sans, with the brush face kept for the one word it
 * is doing identity on.
 *
 * Ubuntu is not a variable font — Google ships it as static 300/400/500/700 —
 * so `weight` is mandatory and each one is its own download. Two are asked
 * for, and they are exactly the two the page sets: 400 for the tagline and
 * the email field, 700 for the sixteen `font-bold` headings. Nothing here
 * asks for 600 or 800, so nothing is synthesised and nothing is fetched to sit
 * unused — every `font-semibold` on the page is on a body-face element, and
 * Open Sans is variable and covers it.
 */
const ubuntu = Ubuntu({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-ubuntu",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Half Life by Hack Club",
  description:
    "Ten weeks. Five projects designed, five projects built. Hack Club funds your parts and ships you a 3D printer at the end. Ages 13-18, no experience needed.",
  openGraph: {
    title: "Half Life by Hack Club",
    description: "Design five hardware projects, then build all five. Hack Club funds the parts and ships the prizes.",
    type: "website",
  },
}

export const viewport: Viewport = {
  themeColor: "#31222c",
  colorScheme: "dark",
}

const DIRECTION_CONTRACT = `<!--
IMPECCABLE DIRECTION CONTRACT

THESIS: Half Life is a ten-week production line for hardware, so the page is
drawn as the line itself — a thick schematic band that physically links each
stage to the next. It refuses the stacked equal-cards "how it works" row that
every program page ships.

OWN-WORLD: Palette is the Figma "color scheme" frame verbatim — ink #31222c
ground, paper #ededed panels, cyan #8ed3dc traces, deep blue #397cbe hero
block, periwinkle #a39bd6 and lavender #c9c7ec bands. Masterpiece brush on the
wordmark, Ubuntu display and tagline, Open Sans body. Square corners, no shadows: flat plates and thick
tapering vector bands, like control-panel silkscreen.

STORY: A 13-18 year old sees the offer and the prize in one viewport, drops an
email, then follows the band down through design -> funding -> build -> printer,
picking up the asides on the way, and leaves believing this is real and free.

FIRST VIEWPORT: Full-bleed illustrated plant-room art under an ink wash; a deep
blue plate holds the wordmark, the ten-week promise, and one paper email field
with a cyan submit. Bottom-left, a hand-angled "here's what you'll make!" over
a scatter of project photos. The "how does it work?" plate breaks the fold.

FORM: Reproduction of the user's approved comp (Figma 275:8) — brief-pinned, so
no concept roll was dealt. seed: brief-pinned/figma-275-8.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${openSans.variable} ${ubuntu.variable} ${masterpiece.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-hl-ink text-hl-paper">
        <div hidden dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
        {children}
      </body>
    </html>
  )
}
