import { after } from "next/server"
import { mirrorReviewDecision, reviewStatusForResult } from "@/lib/airtable/sync"
import { fail, ok, parseBody } from "@/lib/api"
import { Phase } from "@/lib/enums"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { notifyReviewOutcome } from "@/lib/notifications"
import { hasPermission, Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { finalizeReview } from "@/lib/review"
import { sanitize, sanitizeOptional } from "@/lib/sanitize"
import { decisionSchema } from "@/lib/schemas/review"

interface Params {
	params: Promise<{ id: string }>
}

export const maxDuration = 60

export const POST = withPermission(
	Permission.REVIEW_SUBMISSIONS,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, decisionSchema)
		if (parsed.error) return parsed.error
		const body = parsed.data

		// The tier table is the reviewer's whole vocabulary for funding. Writing a freehand dollar amount straight onto a grant row is an admin action – otherwise REVIEWER quietly carries the authority MANAGE_CREDIT withholds.
		if (
			"grantUsdOverride" in body
			&& body.grantUsdOverride !== undefined
			&& !hasPermission(gate.roles, Permission.MANAGE_CREDIT)
		)
			return fail("FORBIDDEN", "Overriding the grant amount requires the MANAGE_CREDIT permission")

		// The same hole one step removed: the tier decides the grant via the tier table, so raising it above what the maker requested mints parts money without MANAGE_CREDIT either. A reviewer may still lower it (or keep it); only the raise needs the permission. Checked on design approvals, which is the only place the tier moves money.
		if ("tier" in body && body.tier != null && !hasPermission(gate.roles, Permission.MANAGE_CREDIT)) {
			const sub = await db.orm.public.PhaseSubmission.whereUnique({ id })
				.select("phase")
				.include("themeProject", project => project.select("requestedTier"))
				.first()
			const cap = sub?.phase === Phase.DESIGN ? (sub.themeProject?.requestedTier ?? null) : null
			if (cap !== null && body.tier > cap)
				return fail(
					"FORBIDDEN",
					"Raising the tier above what the maker requested requires the MANAGE_CREDIT permission",
				)
		}

		const feedback = sanitize(body.feedback ?? "")

		const outcome = await finalizeReview({
			feedback,
			grantUsdOverride: "grantUsdOverride" in body ? (body.grantUsdOverride ?? null) : null,
			hoursOverride: "hoursOverride" in body ? (body.hoursOverride ?? null) : null,
			reason: "reason" in body ? sanitizeOptional(body.reason) : null,
			result: body.result,
			reviewerEmail: gate.user.email,
			reviewerId: gate.user.id,
			reviewerName: gate.user.name,
			submissionId: id,
			tier: "tier" in body ? (body.tier ?? null) : null,
		})

		// After the response: moving the row and telling the maker must not hold up the reviewer, and a Slack or Airtable outage must not fail a decision that has already committed.
		after(async () => {
			// The row's Loops columns, so a decision made here reaches Loops the same way an Ari one does.
			await mirrorReviewDecision(
				outcome.themeProjectId,
				outcome.phase,
				reviewStatusForResult(outcome.result),
				feedback || null,
				gate.user.email,
			)
			await notifyReviewOutcome({
				decidedBy: "console",
				// A console reviewer always writes the note themselves, so an empty one is an empty one rather than a missing field.
				note: feedback || null,
				phase: outcome.phase,
				result: outcome.result,
				themeProjectId: outcome.themeProjectId,
			})
		})

		return ok({ outcome })
	},
)
