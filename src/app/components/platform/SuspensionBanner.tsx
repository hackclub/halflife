import db from "@/lib/prisma8"
import { parseDbTimestamp } from "@/lib/time"

/**
 * The one thing a suspended member must understand the moment a page loads: what they can still do, until when, and why - which is what the guards enforce anyway, restated as information rather than error responses.
 *
 * A server component on purpose: the text is the moderation reason, so it is fetched per request and rendered as plain text, never passed through any markup-affecting path.
 */
export async function SuspensionBanner({ userId }: { userId: string }) {
	const row = await db.orm.public.User.whereUnique({ id: userId })
		.select("suspendedById", "suspendedUntil", "suspensionReason")
		.first()
	if (!row?.suspendedUntil) return null

	return (
		<div className="hl-callout hl-callout--warning" role="status">
			<strong>Your account is suspended.</strong> You can still look around, but you cannot post, comment, like, log
			work or spend until {parseDbTimestamp(row.suspendedUntil).toLocaleString()}.
			{row.suspensionReason ? <p className="hl-hint">Reason: {row.suspensionReason}</p> : null}
		</div>
	)
}
