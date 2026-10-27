import type { Metadata, Viewport } from "next"
import { PlausibleAnalytics } from "@/components/PlausibleAnalytics"
import { PromoBootScript } from "@/components/promo/PromoBootScript"
import { StickerSheetBanner } from "@/components/promo/StickerSheetBanner"
import { siteFontVariables } from "@/components/site/fonts"
import "./globals.css"

export const metadata: Metadata = {
	description:
		"Ten weeks. Five projects designed, five projects built. Hack Club funds your parts and ships you a 3D printer at the end. Ages 13-18, no experience needed.",
	openGraph: {
		description: "Design five hardware projects, then build all five. Hack Club funds the parts and ships the prizes.",
		title: "Half Life by Hack Club",
		type: "website",
	},
	title: "Half Life by Hack Club",
}

export const viewport: Viewport = {
	colorScheme: "dark",
	themeColor: "#31222c",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
	return (
		<html className={`${siteFontVariables} h-full antialiased`} lang="en" suppressHydrationWarning>
			<head>
				<PlausibleAnalytics />
				<PromoBootScript />
			</head>
			<body className="min-h-full flex flex-col bg-hl-ink text-hl-paper">
				<a
					className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:bg-hl-cyan focus:px-4 focus:py-2 focus:font-semibold focus:text-hl-ink"
					href="#how-it-works"
				>
					Skip to how it works
				</a>
				<StickerSheetBanner />
				{children}
			</body>
		</html>
	)
}
