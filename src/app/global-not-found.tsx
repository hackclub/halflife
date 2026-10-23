import type { Metadata, Viewport } from "next"
import { NotFoundScene } from "@/components/site/not-found-scene"
import "./(site)/globals.css"

/**
 * A URL that matches no route at all. There are two root layouts, `(site)` and `(platform)`, so no single layout exists for Next to compose an ordinary 404 from; this is the whole document instead (see the `globalNotFound` flag in next.config.ts). It is drawn in the landing's world, so it takes the landing's stylesheet.
 */
const metadata: Metadata = {
	title: "Page not found · Half Life by Hack Club",
}

const viewport: Viewport = {
	colorScheme: "dark",
	themeColor: "#31222c",
}

export default function GlobalNotFound() {
	return (
		<html lang="en">
			<body>
				<NotFoundScene />
			</body>
		</html>
	)
}

export { metadata, viewport }
