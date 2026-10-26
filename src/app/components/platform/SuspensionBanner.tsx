import db from "@/lib/prisma8"
import { parseDbTimestamp } from "@/lib/time"

/**
 * The one thing a suspended member must understand the moment a page loads: what they can still do, until when, and why - which is what the guards enforce anyway, restated as information rather than error responses.
 *
 * A server component on purpose: the text is the moderation reason, so it is fetched per request and rendered as plain text, never passed through any markup-affecting path.
 */
export async function SuspensionBanner({ userId }: { userId: string }) {
	const row = await db.orm.public.User.whereUnique({ id: userId }).select("suspendedUntil", "suspensionReason").first()
	if (!row?.suspendedUntil) return null

	return (
		<div className="mx-auto w-full max-w-3xl px-4 pt-4" role="status">
			<div className="rounded-xl border-2 border-orange bg-orange/10 px-4 py-3 text-ink">
				<p className="font-semibold">Your account is suspended.</p>
				<p>
					You can still look around, but you cannot post, comment, like, log work or spend until{" "}
					{parseDbTimestamp(row.suspendedUntil).toLocaleString()}.
				</p>
				{row.suspensionReason ? <p className="mt-1 text-sm text-navy-soft">Reason: {row.suspensionReason}</p> : null}
			</div>
		</div>
	)
}
