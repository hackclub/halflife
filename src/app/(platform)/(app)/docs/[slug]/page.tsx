import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Fragment } from "react"
import { ArticleLink } from "@/components/platform/docs/ArticleLink"
import { IconArrowRight, IconChevronLeft } from "@/components/platform/icons"
import { Panel } from "@/components/platform/ui"
import { DOCS } from "@/lib/data"

/**
 * Wraps the 5-coins figure in the same gold pill the onboarding flow and project page use (`bg-gold-pale text-gold-ink`). Docs paragraphs are plain strings, so the highlight happens here at render time rather than in the copy itself.
 */
function highlightCoins(text: string): string | React.ReactNode[] {
	const parts = text.split(/(\b5 coins\b|\b5 per hour\b)/g)
	if (parts.length === 1) return text
	return parts.map((part, i) =>
		i % 2 === 1 ? (
			<strong className="rounded bg-gold-pale px-1 text-gold-ink" key={i}>
				{part}
			</strong>
		) : (
			<Fragment key={i}>{part}</Fragment>
		),
	)
}

export function generateStaticParams() {
	return DOCS.map(d => ({ slug: d.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
	const { slug } = await params
	const doc = DOCS.find(d => d.slug === slug)
	return { title: doc ? `${doc.title} – Half Life docs` : "Docs – Half Life" }
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params
	const doc = DOCS.find(d => d.slug === slug)
	if (!doc) notFound()

	const i = DOCS.findIndex(d => d.slug === slug)
	const next = DOCS[i + 1]

	return (
		<div className="mx-auto w-full max-w-250 px-4 pt-6 sm:px-8">
			<Link
				className="label inline-flex items-center gap-1.5 text-navy-soft transition-colors hover:text-navy"
				href="/docs"
			>
				<IconChevronLeft className="text-base" /> All docs
			</Link>

			<div className="mt-6 grid gap-10 lg:grid-cols-[1fr_220px] lg:items-start">
				<article>
					<p className="label text-teal-ink">{doc.section}</p>
					<h1 className="mt-2 text-[clamp(2rem,5.5vw,3rem)] leading-[1.03] font-extrabold tracking-[-0.04em] text-navy">
						{doc.title}
					</h1>
					<p className="mt-3 max-w-[60ch] text-[1.05rem] leading-relaxed text-navy-soft">{doc.summary}</p>

					<div className="mt-9 grid gap-9">
						{doc.body.map(block => (
							<section id={block.heading.toLowerCase().replaceAll(/\s+/g, "-")} key={block.heading}>
								<h2 className="text-[1.4rem] leading-tight font-extrabold tracking-[-0.025em] text-navy">
									{block.heading}
								</h2>
								<div className="mt-3 grid gap-4">
									{block.paragraphs.map(p => (
										<p className="max-w-[68ch] text-[1rem] leading-[1.75] text-navy" key={p.slice(0, 24)}>
											{highlightCoins(p)}
										</p>
									))}
								</div>
								{block.list && (
									<ul className="mt-4 grid max-w-[64ch] gap-2">
										{block.list.map(li => (
											<li className="flex gap-3 text-[0.96rem] leading-relaxed text-navy" key={li}>
												<span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-teal" />
												{li}
											</li>
										))}
									</ul>
								)}
								{block.link && (
									<a
										className="mt-4 inline-flex items-center gap-1.5 font-semibold text-sky-ink underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
										href={block.link.href}
										rel="noopener noreferrer"
										target="_blank"
									>
										{block.link.label} <IconArrowRight className="text-base" />
									</a>
								)}
							</section>
						))}
					</div>

					{next && (
						<Panel
							className="group mt-12 bg-mint transition-transform duration-150 hover:-translate-y-0.5 hover:before:border-teal-deep focus-within:before:border-teal-deep active:translate-y-px active:before:border-teal-dark before:transition-colors before:duration-150"
							radius={18}
							tone="teal"
						>
							<ArticleLink className="flex items-center gap-4 px-5 py-4" href={`/docs/${next.slug}`}>
								<span className="min-w-0 flex-1">
									<span className="label block text-teal-ink">Next</span>
									<span className="mt-0.5 block text-[1.05rem] leading-tight font-extrabold text-navy transition-colors group-hover:text-teal-dark group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4">
										{next.title}
									</span>
								</span>
								<IconArrowRight className="shrink-0 text-xl text-teal-ink transition-[color,transform] duration-200 group-hover:translate-x-1 group-hover:text-teal-dark group-active:translate-x-1.5" />
							</ArticleLink>
						</Panel>
					)}
				</article>

				<nav aria-label="On this page" className="hidden lg:sticky lg:top-24 lg:block">
					<p className="label mb-3 text-navy-faint">On this page</p>
					<ul className="grid gap-2 border-l border-dashed border-line pl-4">
						{doc.body.map(b => (
							<li key={b.heading}>
								<a
									className="block text-[0.86rem] leading-snug text-navy-soft transition-colors hover:text-navy"
									href={`#${b.heading.toLowerCase().replaceAll(/\s+/g, "-")}`}
								>
									{b.heading}
								</a>
							</li>
						))}
					</ul>
				</nav>
			</div>

			<div className="h-16" />
		</div>
	)
}
