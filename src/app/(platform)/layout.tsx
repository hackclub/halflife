import type { Metadata, Viewport } from "next"
import { ThemeBootScript } from "@/app/components/admin/ThemeBootScript"
import { PlausibleAnalytics } from "@/components/PlausibleAnalytics"
import { SketchDefs } from "@/components/platform/art"
import { platformFontVariables } from "@/components/platform/fonts"
import { WorldGuard } from "@/components/WorldGuard"
import "./globals.css"

/**
 * The platform's root layout: fonts, tokens, and the filter definitions every hand-drawn edge in the app points at.
 *
 * Deliberately has no participant chrome. The sidebar, the Doomscroller rail and the store that feeds them live one level down in `(app)`, so the staff surfaces in `(ops)` can share this design system without inheriting a shell that assumes a session and a trail.
 */
export const metadata: Metadata = {
	description:
		"Design five hardware projects, then build all five. Ten weeks, real funding, and a 3D printer at the end.",
	title: {
		default: "Half Life",
		template: "%s · Half Life",
	},
}

export const viewport: Viewport = {
	initialScale: 1,
	themeColor: "#fcf7f7",
	viewportFit: "cover",
	width: "device-width",
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
	return (
		<html className={platformFontVariables} lang="en" suppressHydrationWarning>
			<head>
				<PlausibleAnalytics />
				<ThemeBootScript />
			</head>
			<body data-world="platform">
				<WorldGuard world="platform" />
				<SketchDefs />
				{children}
			</body>
		</html>
	)
}
