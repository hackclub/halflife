/* oxlint-disable import/group-exports -- Next.js reads segment config exports statically */

import { PhaseStatus } from "@/app/generated/prisma/enums"
import { fail, ok, parseBody } from "@/lib/api"
import { isAriConfigured, sendSubmissionToAri } from "@/lib/ari"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { statusFor } from "@/lib/phase"
import prisma from "@/lib/prisma"
import { phaseBodySchema } from "@/lib/schemas/common"
import { trackSideEffect } from "@/lib/side-effects"

interface Params {
	params: Promise<{ id: string }>
}

export const maxDuration = 60

/**
 * Re-send a hand-in that never reached Ari – a send that failed, or one made before the ARI_* secrets were set. Same work the hourly retry job does, for the one submission an admin is looking at.
 *
 * Sending writes an ARI_SYNC_SUCCESS/FAILURE audit row through trackSideEffect, so a replay is as visible as the original attempt.
 */
export const POST = withPermission(
	Permission.MANAGE_PROGRAM,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, phaseBodySchema)
		if (parsed.error) return parsed.error

		if (!isAriConfigured()) return fail("NOT_CONFIGURED", "Ari is not configured on this deployment")

		// A ship is a hand-in, so only a phase awaiting review has one to send: a draft was never submitted, and a decided phase is already Ari's record.
		const project = await prisma.themeProject.findFirst({
			select: { buildStatus: true, designStatus: true },
			where: { deletedAt: null, id },
		})
		if (!project) return fail("NOT_FOUND", "Project not found")
		const status = statusFor(project, parsed.data.phase)
		if (status !== PhaseStatus.in_review)
			return fail("CONFLICT", "That phase is not awaiting review, so there is no ship to send")

		// A hand-in that already reached Ari has nothing to retry; resending is harmless there (Ari dedupes by external id) but the button should say so rather than perform a no-op round trip.
		const open = await prisma.phaseSubmission.findFirst({
			orderBy: { createdAt: "desc" },
			select: { ariSubmissionId: true },
			where: { phase: parsed.data.phase, resolvedAt: null, themeProjectId: id },
		})
		if (open?.ariSubmissionId)
			return fail("CONFLICT", "That submission already reached Ari – there is nothing to retry")

		try {
			const result = await trackSideEffect(
				"ari",
				{
					actorEmail: gate.user.email,
					actorId: gate.user.id,
					metadata: { manual: true, phase: parsed.data.phase },
					targetId: id,
					targetType: "ThemeProject",
				},
				() => sendSubmissionToAri(id, parsed.data.phase),
				// The audit row is written either way; rethrowing lets a refusal that names a missing field reach the admin instead of a generic failure.
				{ rethrow: true },
			)
			return ok({ result })
		} catch (err) {
			if (err instanceof HttpError) return fail(err.code, err.message)
			return fail("UNAVAILABLE", "Ari did not accept the ship; the audit log has the error")
		}
	},
)
