import { PhaseStatus } from "@/app/generated/prisma/enums"
import { syncSubmissionToYsws } from "@/lib/airtable/sync"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
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
 * Replay a submission-row write that failed the first time, or refresh a row with the project as it stands now. Writes to the same row as before.
 *
 * The audit log is where a failed sync shows up; this is how an admin fixes it.
 */
export const POST = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.MANAGE_PROGRAM)
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, phaseBodySchema)
	if (parsed.error) return parsed.error

	// A row is a submission, so only a phase that has been handed in gets one – never a draft, which is how an empty 0-hour row would otherwise appear.
	const project = await prisma.themeProject.findUnique({
		select: { buildStatus: true, designStatus: true },
		where: { id },
	})
	if (!project) return fail("NOT_FOUND", "Project not found")
	const status = statusFor(project, parsed.data.phase)
	if (status === PhaseStatus.draft)
		return fail("VALIDATION_FAILED", "That phase has not been submitted, so it has no Airtable row")

	const result = await trackSideEffect(
		"airtable",
		{
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: { manual: true, phase: parsed.data.phase },
			targetId: id,
			targetType: "ThemeProject",
		},
		() => syncSubmissionToYsws(id, parsed.data.phase),
	)

	// A skip means Airtable was never asked, or the row could not be built – report it instead of showing the admin a green result for nothing.
	if (result && "skipped" in result)
		return fail("UNAVAILABLE", `Airtable did not take the sync (${result.skipped}); check the deployment configuration`)

	return ok({ result })
})
