import type { Metadata, Viewport } from "next"
import { SketchDefs } from "@/components/platform/art"
import { platformFontVariables } from "@/components/platform/fonts"
import "../(platform)/globals.css"

export const metadata: Metadata = {
	// This page is reached from a QR code and is a one-shot upload target. Nothing about it should ever be indexed or shared onward.
	robots: { follow: false, index: false },
	title: "Record for Half-Life",
}

export const viewport: Viewport = {
	initialScale: 1,
	themeColor: "#fcf7f7",
	viewportFit: "cover",
	width: "device-width",
}

/**
 * A third root layout, for the phone.
 *
 * Separate from (platform) because this page is public by design – the whole point is recording without signing in on your phone – so it must not sit under a layout whose job is to enforce a session. It is still drawn in the platform's world: the same stylesheet and fonts, and the same filter definitions, so the hand-drawn sign and every `.sketch` edge render here as they do on the trail.
 */
export default function HandoffLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html className={platformFontVariables} lang="en">
			<body>
				<SketchDefs />
				{children}
			</body>
		</html>
	)
}
