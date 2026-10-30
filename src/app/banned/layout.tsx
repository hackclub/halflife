import type { Metadata, Viewport } from "next"
import { siteFontVariables } from "@/components/site/fonts"
import "../(site)/globals.css"

export const metadata: Metadata = {
	description: "This account can no longer access Half Life.",
	title: "Account banned – Half Life",
}

/**
 * /banned has no chrome on purpose: it is the front door screen for accounts refused at sign-in, not a page of the site. Everything it shows is the account's own words to itself, so the design system's landing or trail chrome would only imply the account is still welcome.
 */
export const viewport: Viewport = {
	colorScheme: "dark",
	themeColor: "#31222c",
}

export default function BannedLayout({ children }: { children: React.ReactNode }) {
	return (
		<html className={`${siteFontVariables} h-full antialiased`} lang="en">
			<body className="flex min-h-full flex-col bg-hl-ink text-hl-paper" data-world="site">
				{children}
			</body>
		</html>
	)
}
