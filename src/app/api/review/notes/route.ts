import { fail, ok, parseBody } from "@/lib/api"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { sanitize } from "@/lib/sanitize"
import { reviewNoteSchema } from "@/lib/schemas/review"

/**
 * A reviewer's note for other reviewers, or a flag on the project, from the review screen's "Flags & notes".
 *
 * The ship it is written from decides which project and maker it is about, so a note cannot be pinned on someone the reviewer has not opened. A project carries at most one standing flag.
 */
export const POST = withWritePermission(
	Permission.REVIEW_SUBMISSIONS,
	async (req: Request, { gate }: AuthedContext) => {
		const parsed = await parseBody(req, reviewNoteSchema)
		if (parsed.error) return parsed.error
		const { body, flag, subject, submissionId } = parsed.data

		const submission = await db.orm.public.PhaseSubmission.whereUnique({ id: submissionId })
			.select("id")
			.include("themeProject", proj => proj.select("deletedAt", "id", "userId"))
			.first()
		const project = submission?.themeProject
		// The same null the review screen gives a reviewer's own work, which does not confirm the ship exists.
		if (!project || project.deletedAt || project.userId === gate.user.id) return fail("NOT_FOUND", "Ship not found")

		if (flag) {
			const standing = await db.orm.public.ReviewNote.where({ clearedAt: null, flag: true, themeProjectId: project.id })
				.select("id")
				.first()
			if (standing) return fail("CONFLICT", "This project is already flagged")
		}

		const note = await db.orm.public.ReviewNote.create({
			authorId: gate.user.id,
			body: sanitize(body),
			flag,
			makerId: project.userId,
			submissionId: !flag && subject === "ship" ? submission.id : null,
			themeProjectId: flag || subject !== "maker" ? project.id : null,
		})

		return ok({ id: note.id }, { status: 201 })
	},
)
