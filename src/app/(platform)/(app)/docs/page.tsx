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
		<div className="mx-auto w-full max-w-[800px] px-4 pt-2 sm:px-8">
			<PageSign color="var(--color-teal)" ink="#ffffff" label="DOCS" sub="Confused? Start here!" />

			<div className="grid gap-9">
				<section>
					<h2 className="label mb-3 text-navy-faint">Starter projects</h2>
					<Panel className="bg-paper" radius={18} tone="orange">
						<ArticleLink className="group flex items-center gap-4 px-5 py-4 sm:px-6 sm:py-5" href="/starter-projects">
							<span className="min-w-0 flex-1">
								<span className="block text-[1.1rem] leading-tight font-extrabold text-navy transition-colors group-hover:text-orange-ink">
									Week 4: seven displays to start from
								</span>
								<span className="mt-1 block text-[0.88rem] leading-snug text-navy-soft">
									LEDs, filament, 7-segment, NeoPixels, matrices, OLEDs and TFTs, each with a full guide.
								</span>
							</span>
							<IconArrowRight className="shrink-0 text-xl text-navy-faint transition-transform duration-200 group-hover:translate-x-1 group-hover:text-orange-ink" />
						</ArticleLink>
					</Panel>
				</section>
				{sections.map(section => (
					<section key={section}>
						<h2 className="label mb-3 text-navy-faint">{section}</h2>
						<ul className="grid gap-3">
							{DOCS.filter(d => d.section === section).map(doc => (
								<Panel as="li" className="bg-paper" key={doc.slug} radius={18} tone="line">
									<ArticleLink
										className="group flex items-center gap-4 px-5 py-4 sm:px-6 sm:py-5"
										href={`/docs/${doc.slug}`}
									>
										<span className="min-w-0 flex-1">
											<span className="block text-[1.1rem] leading-tight font-extrabold text-navy transition-colors group-hover:text-teal-ink">
												{doc.title}
											</span>
											<span className="mt-1 block text-[0.88rem] leading-snug text-navy-soft">{doc.summary}</span>
										</span>
										<IconArrowRight className="shrink-0 text-xl text-navy-faint transition-transform duration-200 group-hover:translate-x-1 group-hover:text-teal-ink" />
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
