import { after } from "next/server"
import { z } from "zod"
import { fail, ok, parseBody } from "@/lib/api"
import { displayName } from "@/lib/display-name"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { isSporkConfigured, SPORK_VERDICTS, screenWithSpork, setSporkVerdict } from "@/lib/telescreen"

interface Params {
	params: Promise<{ id: string }>
}

const bodySchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("run") }),
	z.object({ action: z.literal("verdict"), verdict: z.enum(SPORK_VERDICTS).nullable() }),
])

/**
 * The review screen's Spork card (see lib/telescreen): screen the repo again, after the response because a big STEP model takes minutes, or mark the flag real or false (null clears the mark).
 *
 * Held to the review screen's rules: REVIEW_SUBMISSIONS, and a 404 for your own work.
 */
export const POST = withWritePermission(
	Permission.REVIEW_SUBMISSIONS,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const parsed = await parseBody(req, bodySchema)
		if (parsed.error) return parsed.error
		const submission = await db.orm.public.PhaseSubmission.whereUnique({ id: (await params).id })
			.select("themeProjectId")
			.include("themeProject", proj => proj.select("deletedAt", "id", "userId"))
			.first()
		const project = submission?.themeProject
		if (!project || project.deletedAt || project.userId === gate.user.id) return fail("NOT_FOUND", "Ship not found")

		if (parsed.data.action === "verdict") {
			await setSporkVerdict(project.id, parsed.data.verdict, displayName(gate.user, "Reviewer"))
			return ok({ ok: true })
		}
		if (!isSporkConfigured()) return fail("NOT_CONFIGURED", "Spork isn't set up. Add SPORK_API_KEY first.")
		after(async () => {
			try {
				await screenWithSpork(project.id)
			} catch (err) {
				console.error("[spork] screen failed:", err)
			}
		})
		return ok({ queued: true }, { status: 202 })
	},
)
