import type { ReactNode } from "react"
import { StarterRender } from "@/components/platform/art"
import { IconBook, IconFile } from "@/components/platform/icons"
import { Panel } from "@/components/platform/ui"
import { cx } from "@/lib/cx"

interface StarterProjectCardData {
	description: string
	guideUrl: string
	id: string
	parts: readonly string[]
	repoUrl: string
	title: string
}

const LINK =
	"inline-flex items-center gap-1.5 font-semibold text-sky-ink underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"

/**
 * One way to start a week's project, as a card: a picture on its own tile, a label and a title, a few lines about it, and the button that picks it.
 *
 * Sized by its container, not the window, because it sits in places of very different widths. Narrow, the picture leads on top; given room, it stands beside the words. `stacked` keeps it on top whatever the width, for cards laid side by side as a choice, where every card has to share one shape and keep its button on the same line as its neighbour's.
 */
export function ProjectChoiceCard({
	art,
	tileClassName,
	flush = false,
	label,
	title,
	children,
	action,
	chosen = false,
	stacked = false,
	className,
}: {
	art: ReactNode
	/** The tile's ground, chosen to suit the picture on it. */
	tileClassName: string
	/** Drop the tile's own padding, for a render that carries its own background and should run to the tile's edges. */
	flush?: boolean
	label: string
	title: string
	children: ReactNode
	action?: ReactNode
	chosen?: boolean
	stacked?: boolean
	className?: string
}) {
	return (
		<Panel
			className={cx("@container bg-white", stacked && "flex h-full flex-col", className)}
			radius={18}
			tone={chosen ? "teal" : "line"}
		>
			<div
				className={cx(
					"flex flex-col gap-4 p-4",
					stacked ? "h-full" : "@md:flex-row @md:items-center @md:gap-5 @md:p-5",
				)}
			>
				<div
					className={cx(
						"grid shrink-0 place-items-center rounded-xl",
						!flush && "px-5 py-4",
						!stacked && "@md:w-[190px] @md:self-stretch",
						tileClassName,
					)}
				>
					{art}
				</div>

				<div className={cx("min-w-0 flex-1", stacked && "flex flex-col")}>
					<p className="label text-teal-ink">{label}</p>
					<h3 className="mt-1 text-[1.2rem] leading-tight font-extrabold text-navy">{title}</h3>
					{children}
					{action ? <div className={cx("pt-4", stacked && "mt-auto")}>{action}</div> : null}
				</div>
			</div>
		</Panel>
	)
}

/**
 * A starter project, as the people it is offered to meet it: the board as its designer rendered it, what it is, what goes on it, and the two links that make it a starter rather than a suggestion. The guide walks you through it; the repo is what it ends up as.
 *
 * `action` is the caller's: onboarding's "Build Starbie", the checkpoint's "Build Starbie", or nothing where the card is only there to be read.
 */
export function StarterProjectCard({
	starter,
	action,
	chosen = false,
	stacked = false,
	className,
}: {
	starter: StarterProjectCardData
	action?: ReactNode
	chosen?: boolean
	stacked?: boolean
	className?: string
}) {
	return (
		<ProjectChoiceCard
			action={action}
			art={
				<StarterRender
					// Stacked beside another choice, the tile is a fixed height so the two line up whatever shape each picture is.
					className={stacked ? "h-[140px] w-full" : "aspect-[720/589] w-full max-w-[220px]"}
					id={starter.id}
					sizes="220px"
				/>
			}
			chosen={chosen}
			className={className}
			flush={starter.id === "merbl"}
			label="Starter project"
			stacked={stacked}
			// A dark ground, because the board is gold and the renders are cut out: on paper or cream the edges of the star wash away. Merbl's render is a photo on its own white ground, so it takes a white tile with no padding instead rather than sitting in a navy frame.
			tileClassName={starter.id === "merbl" ? "bg-white" : "bg-navy"}
			title={starter.title}
		>
			<p className="mt-1.5 text-[0.88rem] leading-relaxed text-navy-soft">{starter.description}</p>

			<ul aria-label="On the board" className="mt-3 flex flex-wrap gap-1.5">
				{starter.parts.map(part => (
					<li className="rounded-full bg-cream px-2.5 py-1 text-[0.74rem] font-semibold text-navy-soft" key={part}>
						{part}
					</li>
				))}
			</ul>

			<p className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2 text-[0.86rem]">
				<a className={LINK} href={starter.guideUrl} rel="noopener noreferrer" target="_blank">
					<IconBook className="text-[1rem]" /> Read the guide
				</a>
				<a className={LINK} href={starter.repoUrl} rel="noopener noreferrer" target="_blank">
					<IconFile className="text-[1rem]" /> Project files on GitHub
				</a>
			</p>
		</ProjectChoiceCard>
	)
}

export type { StarterProjectCardData }
