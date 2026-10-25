import type { Metadata } from "next"
import { ArticleLink } from "@/components/platform/docs/ArticleLink"
import { IconArrowRight } from "@/components/platform/icons"
import { PageSign } from "@/components/platform/PageSign"
import { Panel } from "@/components/platform/ui"
import { DOCS } from "@/lib/data"

export const metadata: Metadata = {
	description: "How the program works, how hours are counted, and what reviewers look for.",
	title: "Half Life Docs",
}

export default function DocsIndex() {
	const sections = Array.from(new Set(DOCS.map(d => d.section)))

	return (
		<div className="mx-auto w-full max-w-200 px-4 pt-2 sm:px-8">
			<PageSign color="var(--color-teal)" ink="#ffffff" label="DOCS" sub="Confused? Start here!" />

			<div className="grid gap-9">
				{sections.map(section => (
					<section key={section}>
						<h2 className="label mb-3 text-navy-faint">{section}</h2>
						<ul className="grid gap-3">
							{DOCS.filter(d => d.section === section).map(doc => (
								<Panel
									as="li"
									className="group bg-paper transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-mint/15 hover:before:border-teal-deep focus-within:before:border-teal-deep active:translate-y-px active:bg-mint/25 active:before:border-teal-dark before:transition-colors before:duration-150"
									key={doc.slug}
									radius={18}
									tone="line"
								>
									<ArticleLink className="flex items-center gap-4 px-5 py-4 sm:px-6 sm:py-5" href={`/docs/${doc.slug}`}>
										<span className="min-w-0 flex-1">
											<span className="block text-[1.1rem] leading-tight font-extrabold text-navy transition-colors group-hover:text-teal-ink group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4">
												{doc.title}
											</span>
											<span className="mt-1 block text-[0.88rem] leading-snug text-navy-soft transition-colors group-hover:text-navy">
												{doc.summary}
											</span>
										</span>
										<IconArrowRight className="shrink-0 text-xl text-navy-faint transition-[color,transform] duration-200 group-hover:translate-x-1 group-hover:text-teal-ink group-active:translate-x-1.5 group-active:text-teal-dark" />
									</ArticleLink>
								</Panel>
							))}
						</ul>
					</section>
				))}
			</div>

			<p className="hand py-10 text-center text-[0.86rem] text-navy-soft">
				still stuck? chuck a question in #half-life-help on the Slack!
			</p>
		</div>
	)
}
