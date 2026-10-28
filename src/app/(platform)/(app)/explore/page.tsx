import type { Metadata } from "next"
import Link from "next/link"
import { Avatar } from "@/components/platform/Avatar"
import { IconArrowRight, IconClock, IconFlame } from "@/components/platform/icons"
import { Markdown } from "@/components/platform/Markdown"
import { PageSign } from "@/components/platform/PageSign"
import { ReportButton } from "@/components/platform/report/ReportButton"
import { Panel } from "@/components/platform/ui"
import { excerpt } from "@/lib/markdown"
import { requireSessionPage } from "@/lib/page-guards"
import { effectiveDateFor, getProgramSettings } from "@/lib/program"
import { fmtDay } from "@/lib/projects"
import { getJournalFeed, type JournalRow } from "@/lib/queries/community"
import { DAY_MS } from "@/lib/time"

export const metadata: Metadata = {
	description: "Journal entries from everyone building hardware this week.",
	title: "Half Life Explore",
}

export const dynamic = "force-dynamic"

const GROUPS = ["Today", "Yesterday", "Earlier"] as const
type Group = (typeof GROUPS)[number]

/**
 * Which heading an entry sits under.
 *
 * Bucketed against the PROGRAM's day rather than the reader's: an entry is stamped with the date it counted for, in the program timezone, and that is the same stamp the streak is built from. Comparing it to a browser clock in another timezone would put yesterday's work under "Today" for half the world.
 */
function groupFor(day: string, today: string, yesterday: string): Group {
	if (day === today) return "Today"
	if (day === yesterday) return "Yesterday"
	return "Earlier"
}

function fmtMinutes(m: number) {
	const h = Math.floor(m / 60)
	const rest = m % 60
	return h > 0 ? `${h}h ${rest.toString().padStart(2, "0")}m` : `${rest}m`
}

/** Roughly a long tweet: enough to know what the session was, not the whole of it. */
const EXCERPT_CHARS = 280

function Entry({ entry, viewerId }: { entry: JournalRow; viewerId: string }) {
	const { text, cut } = excerpt(entry.body, EXCERPT_CHARS)
	const href = `/projects/${entry.projectId}#${entry.id}`
	return (
		// `min-w-0` and `overflow-wrap: anywhere` on the card itself, so nothing in it – the entry, a project or author name – can be wider than the column: a grid item is otherwise as wide as its longest unbroken word, and one pasted URL carried the card, and then the page, off the right edge.
		<Panel
			as="article"
			className="min-w-0 bg-paper px-5 py-5 [overflow-wrap:anywhere] sm:px-7 sm:py-6"
			radius={20}
			tone="line"
		>
			{/* A grid rather than a wrapping flex row. A phone cannot hold the avatar, the byline, the date and the report on one line, and letting the flex row fit them all squeezed the byline into a column of single words. The date and the report drop under the byline on a phone, and return to the right from sm, where there is room for all four. */}
			<header className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3.5 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
				<Link
					aria-label={`${entry.author}'s profile`}
					className="shrink-0 rounded-lg transition-transform hover:-translate-y-0.5 active:translate-y-px"
					href={`/u/${entry.authorId}`}
				>
					<Avatar className="size-11 text-[1.15rem]" image={entry.authorImage} name={entry.author} shape="tile" />
				</Link>
				<div className="min-w-0">
					<p className="text-[1.02rem] leading-tight font-extrabold text-navy [overflow-wrap:anywhere]">
						<Link
							className="hover:underline hover:decoration-dashed hover:underline-offset-4"
							href={`/u/${entry.authorId}`}
						>
							{entry.author}
						</Link>{" "}
						<span className="font-semibold text-navy-soft">on</span>{" "}
						<Link className="text-navy hover:underline hover:decoration-2 hover:underline-offset-4" href={href}>
							{entry.project}
						</Link>
					</p>
					<p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
						<span className="hand inline-flex items-center gap-1 text-[0.82rem] text-coral-deep tabular-nums">
							<IconFlame className="text-sm text-coral" /> {entry.streak}
						</span>
						<span className="hand inline-flex items-center gap-1 text-[0.82rem] text-navy-soft tabular-nums">
							<IconClock className="text-sm" /> {fmtMinutes(entry.minutes)}
						</span>
					</p>
				</div>
				<div className="col-start-2 flex shrink-0 items-center justify-between gap-3 sm:col-start-3 sm:row-start-1 sm:justify-end sm:pt-1">
					<time className="label text-navy-faint" dateTime={entry.when}>
						{fmtDay(entry.day)}
					</time>
					{entry.authorId !== viewerId && (
						<ReportButton
							context={text.slice(0, 280)}
							target={{ id: entry.id, type: "DEVLOG" }}
							title="Report this journal entry"
						/>
					)}
				</div>
			</header>

			{/* Journals are written in Markdown, images included – the pictures that back a session live inside the sentence that explains them, so the entry renders as written rather than with a tray of photos underneath. Only its opening, though: the feed is for finding work, and the whole entry is on the project's page. */}
			<Markdown
				className="mt-4 grid max-w-[68ch] gap-3 text-[0.95rem] leading-relaxed text-navy [overflow-wrap:anywhere]"
				source={text}
			/>
			{cut && (
				<Link
					className="hand mt-2 inline-flex items-center gap-1 text-[0.86rem] text-sky-ink underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
					href={href}
				>
					See more <IconArrowRight className="text-sm" />
				</Link>
			)}
		</Panel>
	)
}

export default async function ExplorePage() {
	const { user } = await requireSessionPage()
	const [entries, settings] = await Promise.all([getJournalFeed(), getProgramSettings()])

	const now = new Date()
	const today = effectiveDateFor(now, settings.programTimezone)
	const yesterday = effectiveDateFor(new Date(now.getTime() - DAY_MS), settings.programTimezone)

	return (
		<div className="mx-auto w-full max-w-195 px-4 pt-2 sm:px-8">
			<PageSign
				color="var(--color-sky)"
				label="EXPLORE"
				sub="See what other teenagers around the world are building for Half Life!"
			/>

			<div className="grid grid-cols-[minmax(0,1fr)] gap-6">
				{GROUPS.map(group => {
					const items = entries.filter(e => groupFor(e.day, today, yesterday) === group)
					if (items.length === 0) return null
					return (
						<section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5" key={group}>
							<div className="flex items-center gap-4">
								<span className="h-px flex-1 bg-line" />
								<h2 className="label text-navy-faint">{group}</h2>
								<span className="h-px flex-1 bg-line" />
							</div>
							{items.map(e => (
								<Entry entry={e} key={e.id} viewerId={user.id} />
							))}
						</section>
					)
				})}
			</div>

			<p className="hand py-10 text-center text-[0.86rem] text-navy-soft">
				{entries.length === 0 ? "nobody has journalled yet. be the first." : "that is as far back as the feed goes."}
			</p>
		</div>
	)
}
