import { NotFoundScene } from "@/components/site/not-found-scene"

/**
 * A platform page that called `notFound()`: a project that does not exist, or is not yours. The same page as an unmatched URL (`app/global-not-found.tsx`), so a dead link reads the same wherever it leads.
 */
export default function NotFound() {
	return (
		<>
			<title>Page not found · Half Life by Hack Club</title>
			<NotFoundScene />
		</>
	)
}
