import type { Metadata, Viewport } from "next"
import { Plus_Jakarta_Sans, Shantell_Sans } from "next/font/google"
import { PlausibleAnalytics } from "@/components/PlausibleAnalytics"
import { SketchDefs } from "@/components/platform/art"
import "./globals.css"

/**
 * The platform's root layout: fonts, tokens, and the filter definitions every hand-drawn edge in the app points at.
 *
 * Deliberately has no participant chrome. The sidebar, the Doomscroller rail and the store that feeds them live one level down in `(app)`, so the signed- out login page and the staff surfaces in `(ops)` can share this design system without inheriting a shell that assumes a session and a trail.
 */
const jakarta = Plus_Jakarta_Sans({
	display: "swap",
	subsets: ["latin"],
	variable: "--font-jakarta",
})

const hand = Shantell_Sans({
	display: "swap",
	subsets: ["latin"],
	variable: "--font-hand",
	weight: ["400", "500", "600", "700"],
})

export const metadata: Metadata = {
	description:
		"Design five hardware projects, then build all five. Ten weeks, real funding, and a 3D printer at the end.",
	title: "Half Life: become a hardware expert in 10 weeks",
}

export const viewport: Viewport = {
	initialScale: 1,
	themeColor: "#fcf7f7",
	viewportFit: "cover",
	width: "device-width",
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
	return (
		<html className={`${jakarta.variable} ${hand.variable}`} lang="en">
			<head>
				<PlausibleAnalytics />
			</head>
			<body>
				<SketchDefs />
				{children}
			</body>
		</html>
	)
}
