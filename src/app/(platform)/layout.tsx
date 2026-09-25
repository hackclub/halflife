import type { Metadata, Viewport } from "next"
import { Plus_Jakarta_Sans, Shantell_Sans } from "next/font/google"
import { SketchDefs } from "@/components/platform/art"
import "./globals.css"

/**
 * The platform's root layout: fonts, tokens, and the filter definitions every
 * hand-drawn edge in the app points at.
 *
 * Deliberately has no participant chrome. The sidebar, the Doomscroller rail
 * and the store that feeds them live one level down in `(app)`, so the signed-
 * out login page and the staff surfaces in `(ops)` can share this design
 * system without inheriting a shell that assumes a session and a trail.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
})

const hand = Shantell_Sans({
  subsets: ["latin"],
  variable: "--font-hand",
  weight: ["400", "500", "600", "700"],
  display: "swap",
})

export const metadata: Metadata = {
  title: "Half Life: become a hardware expert in 10 weeks",
  description:
    "Design five hardware projects, then build all five. Ten weeks, real funding, and a 3D printer at the end.",
}

export const viewport: Viewport = {
  themeColor: "#fcf7f7",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${hand.variable}`}>
      <body>
        <SketchDefs />
        {children}
      </body>
    </html>
  )
}
