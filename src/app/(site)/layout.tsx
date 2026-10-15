import type { Metadata, Viewport } from "next"
import { PlausibleAnalytics } from "@/components/PlausibleAnalytics"
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
		<html className={`${siteFontVariables} h-full antialiased`} lang="en">
			<head>
				<PlausibleAnalytics />
			</head>
			<body className="min-h-full flex flex-col bg-hl-ink text-hl-paper">{children}</body>
		</html>
	)
}
