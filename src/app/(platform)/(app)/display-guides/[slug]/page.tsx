import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { IconArrowRight, IconChevronLeft, IconClock } from "@/components/platform/icons"
import { GuideBody, guideHeadings } from "@/components/platform/starters/GuideBody"
import { ProjectFlow } from "@/components/platform/starters/ProjectFlow"
import { ReadingTrail } from "@/components/platform/starters/ReadingTrail"
import { Panel } from "@/components/platform/ui"
import { DISPLAY_STARTERS, displayPhotoSrc, getDisplayStarter } from "@/lib/config/display-starters"
import { getThemeDef } from "@/lib/config/program"
import { Theme } from "@/lib/enums"
import { DISPLAY_GUIDES } from "@/lib/starters/guides"

export function generateStaticParams(): { slug: string }[] {
	return DISPLAY_STARTERS.map(d => ({ slug: d.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
	const { slug } = await params
	const starter = getDisplayStarter(slug)
	return starter
		? { description: starter.short, title: `${starter.title} · Half Life Display Guides` }
		: { title: "Half Life Display Guides" }
}

/**
 * One display's guide, on the platform rather than on GitHub. The header is the picker's details panel at reading size; the body is the doc's guide; the trail beside it marks off sections as you read; and the next display waits at the bottom, the way a doc hands you on to the next one.
 */
export default async function DisplayGuide({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params
	const starter = getDisplayStarter(slug)
	const source = DISPLAY_GUIDES[slug]
	if (!starter || source === undefined) notFound()

	const index = DISPLAY_STARTERS.findIndex(d => d.slug === slug)
	const next = DISPLAY_STARTERS[index + 1]
	const headings = guideHeadings(source)
	const week = getThemeDef(Theme.DISPLAYS)

	return (
		<div className="mx-auto w-full max-w-[1100px] px-4 pt-6 sm:px-8">
			<Link
				className="label inline-flex items-center gap-1.5 text-navy-soft transition-colors hover:text-navy"
				href={`/display-guides?display=${starter.slug}`}
			>
				<IconChevronLeft className="text-base" /> All display guides
			</Link>

			<header className="mt-6 grid gap-6 md:grid-cols-[1fr_minmax(0,22rem)] md:items-center md:gap-10">
				<div>
					<h1 className="text-[clamp(2.2rem,6vw,3.6rem)] leading-[0.98] font-extrabold tracking-[-0.04em] text-balance text-navy">
						{starter.title}
					</h1>
					<p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
						<span className="label rounded-full bg-violet-pale px-2.5 py-1 text-violet-deep">Tier 1</span>
						<span className="hand inline-flex items-center gap-1.5 text-[0.88rem] text-navy-soft">
							<IconClock className="text-[1rem]" /> about {starter.hours} hours · {starter.level.toLowerCase()} · week{" "}
							{week.designWeek}
						</span>
					</p>
					<p className="mt-4 max-w-[56ch] text-[1.08rem] leading-relaxed text-navy-soft">{starter.lead}</p>
				</div>

				<figure className="rotate-[1.5deg]">
					<div className="relative aspect-[4/3] overflow-hidden rounded-[18px] bg-cream shadow-[0_3px_6px_rgba(28,26,89,0.1),0_14px_30px_-14px_rgba(28,26,89,0.4)]">
						<Image
							alt={starter.photo.alt}
							className="object-cover"
							fetchPriority="high"
							fill
							loading="eager"
							sizes="(min-width: 768px) 352px, 100vw"
							src={displayPhotoSrc(starter.photo.file)}
						/>
					</div>
					<figcaption className="hand mt-2 px-1 text-[0.8rem] text-navy-soft">
						Photo: {starter.photo.credit.author}, {starter.photo.credit.licence}, via{" "}
						<a
							className="underline decoration-dashed underline-offset-4 hover:text-navy"
							href={starter.photo.credit.url}
							rel="noopener noreferrer"
							target="_blank"
						>
							Wikimedia Commons
						</a>
					</figcaption>
				</figure>
			</header>

			<ProjectFlow buildWeek={week.buildWeek} designWeek={week.designWeek} />

			<div className="mt-12 grid gap-10 border-t-2 border-dashed border-line pt-10 lg:grid-cols-[minmax(0,1fr)_230px] lg:items-start">
				<article className="min-w-0">
					<GuideBody source={source} />

					{next && (
						<Panel className="mt-14 bg-mint" radius={18} tone="teal">
							<Link className="group flex items-center gap-4 px-5 py-4" href={`/display-guides/${next.slug}`}>
								<span className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-cream">
									<Image alt="" className="object-cover" fill sizes="64px" src={displayPhotoSrc(next.photo.file)} />
								</span>
								<span className="min-w-0 flex-1">
									<span className="label block text-teal-ink">Next display</span>
									<span className="mt-0.5 block text-[1.1rem] leading-tight font-extrabold text-navy">
										{next.title}
									</span>
									<span className="mt-0.5 block text-[0.86rem] text-navy-soft">{next.short}</span>
								</span>
								<IconArrowRight className="shrink-0 text-xl text-teal-ink transition-transform duration-200 group-hover:translate-x-1" />
							</Link>
						</Panel>
					)}
				</article>

				<aside className="hidden lg:sticky lg:top-24 lg:block">
					<ReadingTrail headings={headings} />
				</aside>
			</div>

			<div className="h-16" />
		</div>
	)
}
