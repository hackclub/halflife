import type { ReactNode } from "react"

/**
 * The hanging shop sign. Two straps run up out of the header, a torn plaque swings underneath. Used as the page title on every non-trail route.
 */
export function PageSign({
	label,
	sub,
	color = "var(--color-orange)",
	ink = "var(--color-navy)",
	stripe = "rgba(0,0,0,.075)",
}: {
	label: string
	sub?: ReactNode
	color?: string
	ink?: string
	stripe?: string
}) {
	return (
		<div className="relative flex flex-col items-center -mt-2 pb-6 lg:-mt-[4.5rem]">
			<div aria-hidden="true" className="relative flex w-43 justify-between sm:w-[214px]">
				<span className="h-9 w-[7px] rounded-b-sm bg-navy sm:h-11 lg:h-28" />
				<span className="h-9 w-[7px] rounded-b-sm bg-navy sm:h-11 lg:h-28" />
			</div>

			{/* `min-w` so the plaque is never narrower than the straps pinned to it: a short title would otherwise leave them hanging in mid-air beside it, which is what "Shop" and "Docs" did. The same floor the ops sign (`.hl-sign-board`) carries, and `text-center` goes with it because the heading now stretches into a box wider than its own text. */}
			<div className="relative -mt-1 min-w-[min(340px,100%)] text-center">
				<div
					aria-hidden="true"
					className="torn absolute inset-0 rounded"
					style={{
						backgroundColor: color,
						backgroundImage: `repeating-linear-gradient(112deg, transparent 0 38px, ${stripe} 38px 64px, transparent 64px 104px)`,
						boxShadow: "0 4px 8px rgba(28,26,89,.14), 0 20px 40px -20px rgba(28,26,89,.55)",
					}}
				/>
				<h1
					className="relative px-10 py-3.5 text-[clamp(1.6rem,5.2vw,3rem)] leading-none font-extrabold tracking-[-0.04em] sm:px-16 sm:py-5"
					style={{ color: ink }}
				>
					{label}
				</h1>
			</div>

			{sub && <p className="hand mt-4 max-w-[46ch] text-center text-[0.86rem] leading-relaxed text-navy-soft">{sub}</p>}
		</div>
	)
}
