import type { ReactNode } from "react"

/**
 * The hanging sign: two straps pinned above a torn plaque, with the page title on it.
 *
 * One DOM for both worlds. The straps, the plaque, the tear layer and the heading are the same furniture whether the page is a trail destination or a console screen; only the class set changes. The platform draws it as a torn painted plate in the page's accent, while the console uses the `.hl-sign` rules in `ops.css`. `PageSign` and `PageHeader` are the two call-side names, so a change to the shape is made once here.
 */

const SKINS = {
	console: {
		actions: "hl-row",
		actionsStyle: { justifyContent: "center", marginTop: "1rem" },
		board: "hl-sign-board",
		root: "hl-sign",
		strap: "hl-sign-strap",
		straps: "hl-sign-straps",
		subtitle: "hl-sign-sub",
		tear: "hl-sign-tear",
		title: "",
	},
	platform: {
		actions: "",
		actionsStyle: undefined,
		board: "relative -mt-1 min-w-[min(340px,100%)] text-center",
		root: "relative flex flex-col items-center -mt-2 pb-6 lg:-mt-[4.5rem]",
		strap: "h-9 w-[7px] rounded-b-sm bg-navy sm:h-11 lg:h-28",
		straps: "relative flex w-43 justify-between sm:w-[214px]",
		subtitle: "hand mt-4 max-w-[46ch] text-center text-[0.86rem] leading-relaxed text-navy-soft",
		tear: "torn absolute inset-0 rounded",
		title:
			"relative px-10 py-3.5 text-[clamp(1.6rem,5.2vw,3rem)] leading-none font-extrabold tracking-[-0.04em] sm:px-16 sm:py-5",
	},
} as const

export function HangingSign({
	surface,
	title,
	subtitle,
	actions,
	flush = false,
	color = "var(--color-orange)",
	ink = "var(--color-navy)",
	stripe = "rgba(0,0,0,.075)",
}: Readonly<{
	surface: "platform" | "console"
	title: string
	subtitle?: ReactNode
	/** The console lays actions below the sign; the platform's pages pass none. */
	actions?: ReactNode
	/**
	 * Standalone documents have no header for the straps to tuck under. Flush drops the negative top margin so they start at the page's own top edge instead of leaving a band of ground above them.
	 */
	flush?: boolean
	/** Platform plaque fill. The console's is fixed by `.hl-sign-tear`. */
	color?: string
	/** Platform heading colour. */
	ink?: string
	/** Platform stripe tint. */
	stripe?: string
}>) {
	const skin = SKINS[surface]
	const platform = surface === "platform"
	const rootClass = platform && flush ? "relative flex flex-col items-center pb-6" : skin.root

	const sign = (
		<div className={rootClass}>
			<div aria-hidden="true" className={skin.straps}>
				<span className={skin.strap} />
				<span className={skin.strap} />
			</div>

			{/* `min-w` so the plaque is never narrower than the straps pinned to it: a short title would otherwise leave them hanging in mid-air beside it, which is what "Shop" and "Docs" did. The same floor the console sign carries, and `text-center` goes with it because the heading now stretches into a box wider than its own text. */}
			<div className={skin.board}>
				<div
					aria-hidden="true"
					className={skin.tear}
					style={
						platform
							? {
									backgroundColor: color,
									backgroundImage: `repeating-linear-gradient(112deg, transparent 0 38px, ${stripe} 38px 64px, transparent 64px 104px)`,
									boxShadow: "0 4px 8px rgba(28,26,89,.14), 0 20px 40px -20px rgba(28,26,89,.55)",
								}
							: undefined
					}
				/>
				<h1 className={skin.title || undefined} style={platform ? { color: ink } : undefined}>
					{title}
				</h1>
			</div>

			{subtitle ? <p className={skin.subtitle}>{subtitle}</p> : null}
			{actions ? (
				<div className={skin.actions} style={skin.actionsStyle}>
					{actions}
				</div>
			) : null}
		</div>
	)

	// The console keeps the sign inside a real header landmark; the platform already sits in the page's own header region.
	return surface === "console" ? <header>{sign}</header> : sign
}
