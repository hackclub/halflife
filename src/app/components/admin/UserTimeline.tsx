import { formatUtcDateTime } from "@/lib/deadline"

/** One thing that happened to an account, with the moment it happened. */
export interface TimelineEvent {
	at: Date
	detail?: string
	title: string
}

/**
 * The account's history as one list, newest first, so a reader sees what happened and in what order without moving between panels. Each entry is a moment in UTC, a short title, and an optional detail line.
 */
export function UserTimeline({ events }: Readonly<{ events: TimelineEvent[] }>) {
	const ordered = events.toSorted((a, b) => b.at.getTime() - a.at.getTime())

	return (
		<ol aria-label="Account history, newest first" className="hl-timeline">
			{ordered.map(event => (
				<li key={`${event.at.getTime()}-${event.title}`}>
					<span className="hl-mono hl-timeline-when">{formatUtcDateTime(event.at)}</span>
					<span className="hl-timeline-title">{event.title}</span>
					{event.detail ? <span className="hl-hint">{event.detail}</span> : null}
				</li>
			))}
		</ol>
	)
}
