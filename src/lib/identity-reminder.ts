/**
 * How long the identity reminder keeps quiet after it is dismissed.
 *
 * Verification happens on Hack Club Auth and can take a while, so the reminder asks once a day rather than every hour. It is a nudge, not a gate: nothing on the site waits for the popup to be answered, and the server still refuses grants and shop orders until the check passes.
 *
 * Browser-only arithmetic, kept apart from the component so the window can be checked without rendering anything.
 */
export const IDENTITY_REMINDER_SNOOZE_MS = 24 * 60 * 60 * 1000

/** Where the browser keeps the moment the reminder was last dismissed. */
export const IDENTITY_REMINDER_KEY = "halflife.identity-reminder.dismissed-at"

/** Whether the reminder is due: never dismissed, or dismissed at least the snooze window ago. */
export function identityReminderDue(dismissedAt: number | null, now: number): boolean {
	if (dismissedAt === null) return true
	return now - dismissedAt >= IDENTITY_REMINDER_SNOOZE_MS
}
