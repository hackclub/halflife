/**
 * How long the shipping-address reminder keeps quiet after it is dismissed.
 *
 * The reminder is a warning, not a gate: closing it has to work, but the thing it warns about – approved parts with nowhere to go – does not fix itself. An hour is short enough to catch someone in the same sitting and long enough not to follow them around the whole session.
 *
 * Browser-only arithmetic, kept apart from the component so the window can be checked without rendering anything.
 */
export const ADDRESS_REMINDER_SNOOZE_MS = 60 * 60 * 1000

/** Where the browser keeps the moment the reminder was last dismissed. */
export const ADDRESS_REMINDER_KEY = "halflife.address-reminder.dismissed-at"

/** A stored dismissal as a timestamp, or null when there is none or it is not a time this can trust. */
export function parseDismissedAt(raw: string | null): number | null {
	if (raw === null) return null
	const at = Number(raw)
	return Number.isFinite(at) && at > 0 ? at : null
}

/** Whether the reminder is due: never dismissed, or dismissed at least the snooze window ago. */
export function addressReminderDue(dismissedAt: number | null, now: number): boolean {
	if (dismissedAt === null) return true
	return now - dismissedAt >= ADDRESS_REMINDER_SNOOZE_MS
}
