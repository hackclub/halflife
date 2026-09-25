import type { Metadata } from "next"
import { ArticleLink } from "@/components/platform/docs/ArticleLink"
import { IconArrowRight } from "@/components/platform/icons"
import { PageSign } from "@/components/platform/PageSign"
import { Panel } from "@/components/platform/ui"
import { DOCS } from "@/lib/data"

export const metadata: Metadata = {
  title: "Half Life Docs",
  description: "How the program works, how hours are counted, and what reviewers look for.",
}

export default function DocsIndex() {
  const sections = Array.from(new Set(DOCS.map((d) => d.section)))

  return (
    <div className="mx-auto w-full max-w-[800px] px-4 pt-2 sm:px-8">
      <PageSign label="DOCS" color="var(--color-teal)" ink="#ffffff" sub="Confused? Start here!" />

      <div className="grid gap-9">
        {sections.map((section) => (
          <section key={section}>
            <h2 className="label mb-3 text-line-strong">{section}</h2>
            <ul className="grid gap-3">
              {DOCS.filter((d) => d.section === section).map((doc) => (
                <Panel key={doc.slug} as="li" tone="line" radius={18} className="bg-paper">
                  <ArticleLink
                    href={`/docs/${doc.slug}`}
                    className="group flex items-center gap-4 px-5 py-4 sm:px-6 sm:py-5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[1.1rem] leading-tight font-extrabold text-navy transition-colors group-hover:text-teal-deep">
                        {doc.title}
                      </span>
                      <span className="mt-1 block text-[0.88rem] leading-snug text-navy-soft">{doc.summary}</span>
                      <span className="hand mt-2 inline-flex items-center gap-1.5 text-[0.76rem] text-line-strong"></span>
                    </span>
                    <IconArrowRight className="shrink-0 text-xl text-line-strong transition-transform duration-200 group-hover:translate-x-1 group-hover:text-teal-deep" />
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
