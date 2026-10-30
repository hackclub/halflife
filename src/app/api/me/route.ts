import { ok } from "@/lib/api"
import { avatarUrl } from "@/lib/avatar"
import { getBalances, getEarnedCredit } from "@/lib/currency"
import { withSession } from "@/lib/guards"
import { permissionsFor } from "@/lib/permissions"
import { getPrinterQualification } from "@/lib/printer"
import db from "@/lib/prisma8"
import { parseNullableTimestamp } from "@/lib/time"

export const dynamic = "force-dynamic"

/**
 * Read-only about the viewer: their own profile, roles, credit and printer standing.
 *
 * Nothing here is writable. The one field a participant used to change on this route – which printer they are saving for – moved to `PATCH /api/goal`, because it is only meaningful alongside the answer to "what are you here for", and a route that set one without the other could leave a participant paced against a machine they never asked for.
 */

export const GET = withSession(async (_req: Request, { gate }) => {
	const [user, balances, earned, printer] = await Promise.all([
		db.orm.public.User.whereUnique({ id: gate.user.id })
			.select(
				"email",
				"fraudFlagged",
				"hackatimeUserId",
				"id",
				"image",
				"name",
				"slackId",
				"submissionExtensionUntil",
				"verificationStatus",
			)
			.first(),
		db.transaction(tx => getBalances(tx, gate.user.id)),
		db.transaction(tx => getEarnedCredit(tx, gate.user.id)),
		getPrinterQualification(gate.user.id),
	])

	return ok({
		credit: { ...balances, earned },
		permissions: permissionsFor(gate.roles),
		printer,
		roles: gate.roles,
		user: user
			? {
					...user,
					hackatimeLinked: Boolean(user.hackatimeUserId),
					image: avatarUrl(user),
					submissionExtensionUntil: parseNullableTimestamp(user.submissionExtensionUntil),
				}
			: user,
	})
})
