import { Plus_Jakarta_Sans, Shantell_Sans } from "next/font/google"

/**
 * The platform's two faces, declared once so every document drawn in its world loads the same files: the platform's own root layout, and the handoff page, which is a separate root because it is public.
 *
 * Plus Jakarta sets everything structural; Shantell is the hand-lettered voice used for labels, asides and timestamps. The console relies on the platform layout being above it, so it does not declare them again.
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

/** Both variables, for the `<html>` element of a platform-world document. */
export const platformFontVariables = `${jakarta.variable} ${hand.variable}`
