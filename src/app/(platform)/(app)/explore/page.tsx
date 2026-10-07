import type { Metadata } from "next"
import Link from "next/link"
import { Avatar } from "@/components/platform/Avatar"
import { IconArrowRight, IconClock, IconFlame } from "@/components/platform/icons"
import { excerpt, Markdown } from "@/components/platform/Markdown"
import { PageSign } from "@/components/platform/PageSign"
import { ReportButton } from "@/components/platform/report/ReportButton"
import { Panel } from "@/components/platform/ui"
import { requireSessionPage } from "@/lib/page-guards"
import { effectiveDateFor, getProgramSettings } from "@/lib/program"
import { fmtDay } from "@/lib/projects"
import { getJournalFeed, type JournalRow } from "@/lib/queries/community"

export const metadata: Metadata = {
	title: "Half Life Explore",
	description: "Journal entries from everyone building hardware this week.",
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
			tone="line"
			radius={20}
			as="article"
			className="min-w-0 bg-paper px-5 py-5 [overflow-wrap:anywhere] sm:px-7 sm:py-6"
		>
			<header className="flex flex-wrap items-start gap-3.5">
				<Link
					href={`/u/${entry.authorId}`}
					aria-label={`${entry.author}'s profile`}
					className="shrink-0 rounded-lg transition-transform hover:-translate-y-0.5"
				>
					{entry.authorImage ? (
						// eslint-disable-next-line @next/next/no-img-element -- the avatar host (Slack via Cachet) is known only at runtime
						<img
							src={entry.authorImage}
							alt=""
							className="size-11 rounded-lg border-2 border-line bg-sky-pale object-cover"
						/>
					) : (
						<Avatar name={entry.author} image={null} shape="tile" className="size-11 text-[1.15rem]" />
					)}
				</Link>
				<div className="min-w-0 flex-1">
					<p className="text-[1.02rem] leading-tight font-extrabold text-navy [overflow-wrap:anywhere]">
						<Link
							href={`/u/${entry.authorId}`}
							className="hover:underline hover:decoration-dashed hover:underline-offset-4"
						>
							{entry.author}
						</Link>{" "}
						<span className="font-semibold text-navy-soft">on</span>{" "}
						<Link href={href} className="text-navy hover:underline hover:decoration-2 hover:underline-offset-4">
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
				<time dateTime={entry.when} className="label shrink-0 pt-1 text-navy-faint">
					{fmtDay(entry.day)}
				</time>
				{entry.authorId !== viewerId && (
					<span className="shrink-0 pt-1">
						<ReportButton
							target={{ type: "DEVLOG", id: entry.id }}
							title="Report this journal entry"
							context={text.slice(0, 280)}
						/>
					</span>
				)}
			</header>

			{/* Journals are written in Markdown, images included – the pictures that
          back a session live inside the sentence that explains them, so the
          entry renders as written rather than with a tray of photos
          underneath. Only its opening, though: the feed is for finding work,
          and the whole entry is on the project's page. */}
			<Markdown
				source={text}
				className="mt-4 grid max-w-[68ch] gap-3 text-[0.95rem] leading-relaxed text-navy [overflow-wrap:anywhere]"
			/>
			{cut && (
				<Link
					href={href}
					className="hand mt-2 inline-flex items-center gap-1 text-[0.86rem] text-sky-ink underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
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
	const yesterday = effectiveDateFor(new Date(now.getTime() - 24 * 60 * 60 * 1000), settings.programTimezone)

	return (
		<div className="mx-auto w-full max-w-[780px] px-4 pt-2 sm:px-8">
			<PageSign
				label="EXPLORE"
				color="var(--color-sky)"
				sub="See what other teenagers around the world are building for Half Life!"
			/>

			<div className="grid grid-cols-[minmax(0,1fr)] gap-6">
				{GROUPS.map((group) => {
					const items = entries.filter((e) => groupFor(e.day, today, yesterday) === group)
					if (items.length === 0) return null
					return (
						<section key={group} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
							<div className="flex items-center gap-4">
								<span className="h-px flex-1 bg-line" />
								<h2 className="label text-navy-faint">{group}</h2>
								<span className="h-px flex-1 bg-line" />
							</div>
							{items.map((e) => (
								<Entry key={e.id} entry={e} viewerId={user.id} />
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
