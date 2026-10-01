/**
 * A deadline as people read one, e.g. "Sunday, October 5 at 11:59 PM", in the
 * program's timezone.
 *
 * Pure, so the server's messages and the client's trail print it the same way.
 */
export function formatDeadline(at: Date | number, timeZone: string, style: "long" | "short" = "long"): string {
	const shown = new Date(at)
	const day = shown.toLocaleDateString("en-US", { timeZone, weekday: style, month: style, day: "numeric" })
	const time = shown.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" })
	return `${day} at ${time}`
}
