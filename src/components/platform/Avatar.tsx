import { cx } from "@/lib/cx"

const TONES = ["bg-coral", "bg-violet", "bg-teal", "bg-sky-deep", "bg-orange-deep"]

/**
 * A face for a name: the picture if there is one, else its initial on a colour of its own. The colour is hashed from the name, so the same person keeps the same one on every screen.
 *
 * `round` is the reels' puck; `tile` is the rounded square the feed and the sidebar frame a person in. The shape is a prop rather than a class override because `cx` only joins, and two radii in one class list are settled by whichever Tailwind emits last.
 */
export function Avatar({
	name,
	image,
	shape = "round",
	className,
}: {
	name: string | null
	image: string | null
	shape?: "round" | "tile"
	className?: string
}) {
	const label = (name ?? "?").trim()
	let n = 0
	for (const ch of label) n = (n + ch.charCodeAt(0)) % TONES.length
	const radius = shape === "tile" ? "rounded-lg" : "rounded-full"
	return image ? (
		// eslint-disable-next-line @next/next/no-img-element -- avatars come from the identity provider's CDN
		<img src={image} alt="" className={cx("shrink-0 bg-sky-pale object-cover", radius, className)} />
	) : (
		<span
			aria-hidden="true"
			className={cx(
				"grid shrink-0 place-items-center font-extrabold text-white",
				radius,
				TONES[n] ?? TONES[0],
				className,
			)}
		>
			{label.charAt(0).toUpperCase()}
		</span>
	)
}
