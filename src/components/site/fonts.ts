import { Open_Sans, Ubuntu } from "next/font/google"
import localFont from "next/font/local"

/**
 * The landing's three faces, declared once so every document drawn in the
 * landing's world loads the same files: the site's root layout, and the 404,
 * which renders outside it.
 *
 * Masterpiece is the comp's own display face (Figma 275:8), self-hosted from
 * `public/fonts`. It ships a single 400 brush weight whose strokes overhang
 * their advances – 'I' carries 0.52em of ink on a 0.32em advance – so it is
 * already heavy and must never be synthetically emboldened. See `.font-hand`
 * in globals.css.
 *
 * Licence: free, per `public/fonts/Read me.txt`, with the author asking for a
 * donation to charity for commercial use.
 */
export const masterpiece = localFont({
	src: "../../../public/fonts/Masterpiece.ttf",
	variable: "--font-masterpiece",
	weight: "400",
	style: "normal",
	display: "swap",
})

export const openSans = Open_Sans({
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
 * Ubuntu is not a variable font – Google ships it as static 300/400/500/700 –
 * so `weight` is mandatory and each one is its own download. Two are asked
 * for, and they are exactly the two the page sets: 400 for the tagline and
 * the email field, 700 for the sixteen `font-bold` headings. Nothing here
 * asks for 600 or 800, so nothing is synthesised and nothing is fetched to sit
 * unused – every `font-semibold` on the page is on a body-face element, and
 * Open Sans is variable and covers it.
 */
export const ubuntu = Ubuntu({
	subsets: ["latin"],
	weight: ["400", "700"],
	variable: "--font-ubuntu",
	display: "swap",
})

/** All three variables, for the element a landing-world document hangs them on. */
export const siteFontVariables = `${openSans.variable} ${ubuntu.variable} ${masterpiece.variable}`
