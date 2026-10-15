import { ok, withRoute } from "@/lib/api"
import { avatarUrl } from "@/lib/avatar"
import { getBalances, getEarnedCredit } from "@/lib/currency"
import { requireSession } from "@/lib/guards"
import { permissionsFor } from "@/lib/permissions"
import { getPrinterQualification } from "@/lib/printer"
import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"

/**
 * Read-only about the viewer: their own profile, roles, credit and printer standing.
 *
 * Nothing here is writable. The one field a participant used to change on this route – which printer they are saving for – moved to `PATCH /api/goal`, because it is only meaningful alongside the answer to "what are you here
 * for", and a route that set one without the other could leave a participant
 * paced against a machine they never asked for.
 */

export const GET = withRoute(async () => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const [user, balances, earned, printer] = await Promise.all([
		prisma.user.findUnique({
			where: { id: gate.user.id },
			select: {
				id: true,
				name: true,
				email: true,
				image: true,
				slackId: true,
				verificationStatus: true,
				hackatimeUserId: true,
				fraudFlagged: true,
				submissionExtensionUntil: true,
			},
		}),
		prisma.$transaction(tx => getBalances(tx, gate.user.id)),
		prisma.$transaction(tx => getEarnedCredit(tx, gate.user.id)),
		getPrinterQualification(gate.user.id),
	])

	return ok({
		user: { ...user, image: avatarUrl(user), hackatimeLinked: !!user?.hackatimeUserId },
		roles: gate.roles,
		permissions: permissionsFor(gate.roles),
		credit: { ...balances, earned },
		printer,
	})
})
