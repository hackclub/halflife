import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArticleLink } from "@/components/platform/docs/ArticleLink"
import { IconArrowRight, IconChevronLeft } from "@/components/platform/icons"
import { Panel } from "@/components/platform/ui"
import { DOCS } from "@/lib/data"

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const doc = DOCS.find((d) => d.slug === slug)
  return { title: doc ? `${doc.title} — Half Life docs` : "Docs — Half Life" }
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const doc = DOCS.find((d) => d.slug === slug)
  if (!doc) notFound()

  const i = DOCS.findIndex((d) => d.slug === slug)
  const next = DOCS[i + 1]

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 pt-6 sm:px-8">
      <Link
        href="/docs"
        className="label inline-flex items-center gap-1.5 text-navy-soft transition-colors hover:text-navy"
      >
        <IconChevronLeft className="text-base" /> All docs
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_220px] lg:items-start">
        <article>
          <p className="label text-teal-deep">{doc.section}</p>
          <h1 className="mt-2 text-[clamp(2rem,5.5vw,3rem)] leading-[1.03] font-extrabold tracking-[-0.04em] text-navy">
            {doc.title}
          </h1>
          <p className="mt-3 max-w-[60ch] text-[1.05rem] leading-relaxed text-navy-soft">{doc.summary}</p>
          <p className="hand mt-3 inline-flex items-center gap-1.5 text-[0.8rem] text-line-strong"></p>

          <div className="mt-9 grid gap-9">
            {doc.body.map((block) => (
              <section key={block.heading} id={block.heading.toLowerCase().replace(/\s+/g, "-")}>
                <h2 className="text-[1.4rem] leading-tight font-extrabold tracking-[-0.025em] text-navy">
                  {block.heading}
                </h2>
                <div className="mt-3 grid gap-4">
                  {block.paragraphs.map((p) => (
                    <p key={p.slice(0, 24)} className="max-w-[68ch] text-[1rem] leading-[1.75] text-navy">
                      {p}
                    </p>
                  ))}
                </div>
                {block.list && (
                  <ul className="mt-4 grid max-w-[64ch] gap-2">
                    {block.list.map((li) => (
                      <li key={li} className="flex gap-3 text-[0.96rem] leading-relaxed text-navy">
                        <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-teal" />
                        {li}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          {next && (
            <Panel tone="teal" radius={18} className="mt-12 bg-mint">
              <ArticleLink href={`/docs/${next.slug}`} className="group flex items-center gap-4 px-5 py-4">
                <span className="min-w-0 flex-1">
                  <span className="label block text-teal-deep">Next</span>
                  <span className="mt-0.5 block text-[1.05rem] leading-tight font-extrabold text-navy">
                    {next.title}
                  </span>
                </span>
                <IconArrowRight className="shrink-0 text-xl text-teal-deep transition-transform duration-200 group-hover:translate-x-1" />
              </ArticleLink>
            </Panel>
          )}
        </article>

        <nav aria-label="On this page" className="hidden lg:sticky lg:top-24 lg:block">
          <p className="label mb-3 text-line-strong">On this page</p>
          <ul className="grid gap-2 border-l border-dashed border-line pl-4">
            {doc.body.map((b) => (
              <li key={b.heading}>
                <a
                  href={`#${b.heading.toLowerCase().replace(/\s+/g, "-")}`}
                  className="block text-[0.86rem] leading-snug text-navy-soft transition-colors hover:text-navy"
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
