import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { programEventUpdateSchema } from "@/lib/schemas/admin"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Move, retitle or cancel one occurrence.
 *
 * The path is a single occurrence even when the row is one of ten, and that is
 * the intent: a series is edited a week at a time, since that is the edit that
 * gets made. `endsAt: null` clears a published end time rather than leaving it,
 * because an admin removing an end time means to remove it.
 */
export const PATCH = withPermission(
	Permission.MANAGE_PROGRAM,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, programEventUpdateSchema)
		if (parsed.error) return parsed.error
		const data = parsed.data

		const before = await prisma.programEvent.findUnique({ where: { id } })
		if (!before) return fail("NOT_FOUND", "Event not found")

		// The end is checked against the row's *other* field, which a partial update
		// may not carry: changing the start past a published end has to be refused
		// here rather than silently storing an event that ends before it begins.
		const startsAt = data.startsAt ?? before.startsAt
		const endsAt = data.endsAt === undefined ? before.endsAt : data.endsAt
		if (endsAt && endsAt <= startsAt) return fail("VALIDATION_FAILED", "An event has to end after it starts")

		const event = await prisma.programEvent.update({ data, where: { id } })

		await logAudit({
			action: AuditAction.ADMIN_UPDATE_PROGRAM_EVENT,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: {
				after: {
					colour: event.colour,
					endsAt: event.endsAt?.toISOString() ?? null,
					published: event.published,
					startsAt: event.startsAt.toISOString(),
					title: event.title,
				},
				before: {
					colour: before.colour,
					endsAt: before.endsAt?.toISOString() ?? null,
					published: before.published,
					startsAt: before.startsAt.toISOString(),
					title: before.title,
				},
			},
			targetId: id,
			targetType: "ProgramEvent",
		})

		return ok({ event })
	},
)

/**
 * Remove one occurrence, for good.
 *
 * Delete rather than unpublish, because the two mean different things: unpublish
 * hides an event that is still true, while this is the way a mistakenly-created
 * series is undone. The audit row keeps the before, so what was removed is still
 * answerable afterwards.
 */
export const DELETE = withPermission(
	Permission.MANAGE_PROGRAM,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const before = await prisma.programEvent.findUnique({ where: { id } })
		if (!before) return fail("NOT_FOUND", "Event not found")

		await prisma.programEvent.delete({ where: { id } })

		await logAudit({
			action: AuditAction.ADMIN_DELETE_PROGRAM_EVENT,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: {
				before: {
					colour: before.colour,
					endsAt: before.endsAt?.toISOString() ?? null,
					seriesId: before.seriesId,
					startsAt: before.startsAt.toISOString(),
					title: before.title,
				},
			},
			targetId: id,
			targetType: "ProgramEvent",
		})

		return ok({ id })
	},
)
