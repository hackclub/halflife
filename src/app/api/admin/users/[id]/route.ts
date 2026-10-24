import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { hasRole, Permission, Role } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { getUserDetail } from "@/lib/queries/admin"
import { userFlagsSchema } from "@/lib/schemas/admin"

interface Params {
	params: Promise<{ id: string }>
}

export const dynamic = "force-dynamic"

export const GET = withPermission(
	Permission.VIEW_USERS,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const detail = await getUserDetail(id, {
			includeSensitive: hasRole(gate.roles, Role.ADMIN) || hasRole(gate.roles, Role.AUDITOR),
		})
		if (!detail) return fail("NOT_FOUND", "User not found")
		return ok(detail)
	},
)

export const PATCH = withPermission(
	Permission.MANAGE_USERS,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, userFlagsSchema)
		if (parsed.error) return parsed.error

		const before = await prisma.user.findUnique({
			select: { email: true, fraudFlagged: true, submissionExtensionUntil: true },
			where: { id },
		})
		if (!before) return fail("NOT_FOUND", "User not found")

		// `User.email` has a plain btree unique index, which is case-SENSITIVE: two spellings of one address are two legal rows to Postgres. The address is stored exactly as typed (see the schema), so the duplicate check has to be the case-insensitive one or `Ada@x.com` and `ada@x.com` could both become accounts - and better-auth would then resolve either spelling to whichever row it found first.
		const emailChanged = parsed.data.email !== undefined && parsed.data.email !== before.email
		if (emailChanged) {
			const taken = await prisma.user.findFirst({
				select: { id: true },
				// `id: { not: id }` so retyping this user's own address with different capitalisation is a rewrite of their row, not a collision with it - the insensitive comparison would otherwise match the user against themselves.
				where: { email: { equals: parsed.data.email, mode: "insensitive" }, id: { not: id } },
			})
			if (taken) return fail("CONFLICT", "Another user already has that email address")
		}

		const updated = await prisma.user.update({
			data: {
				...(parsed.data.fraudFlagged !== undefined ? { fraudFlagged: parsed.data.fraudFlagged } : {}),
				...(parsed.data.submissionExtensionUntil !== undefined
					? { submissionExtensionUntil: parsed.data.submissionExtensionUntil }
					: {}),
				...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
				// Provenance is withdrawn with the address. Until now `email` was only ever written by an identity provider, so `findUserByEmail` matching it meant the address genuinely belonged to the HCA identity signing in - and better-auth's implicit account linking (lib/auth.ts trusts the hca provider, and `requireLocalEmailVerified` defaults true) will attach an incoming HCA identity to ANY row whose address matches when that row is `emailVerified`. An address a human typed into the admin panel has no such proof, so the flag must not stay set for a linked account. Clearing it is the main guard; adoptHcaVerifiedEmail (lib/hca-profile) reinforces it by refusing to re-verify any row that already has a linked Account, though it still repairs account-less staff-import rows - so the flag (not the address) is what separates a typed address from a verified one. The next sign-in still works, because it resolves on the HCA account row (providerId + sub) rather than on the address.
				...(emailChanged ? { emailVerified: false } : {}),
			},
			select: { email: true, emailVerified: true, fraudFlagged: true, id: true, submissionExtensionUntil: true },
			where: { id },
		})

		if (parsed.data.fraudFlagged !== undefined && parsed.data.fraudFlagged !== before.fraudFlagged)
			await logAudit({
				action: parsed.data.fraudFlagged ? AuditAction.ADMIN_FLAG_FRAUD : AuditAction.ADMIN_UNFLAG_FRAUD,
				actorEmail: gate.user.email,
				actorId: gate.user.id,
				metadata: { after: parsed.data.fraudFlagged, before: before.fraudFlagged },
				targetId: id,
				targetType: "User",
			})

		if (emailChanged)
			await logAudit({
				action: AuditAction.ADMIN_CHANGE_EMAIL,
				actorEmail: gate.user.email,
				actorId: gate.user.id,
				metadata: { after: parsed.data.email ?? null, before: before.email, emailVerified: false },
				targetId: id,
				targetType: "User",
			})

		if (parsed.data.submissionExtensionUntil !== undefined)
			await logAudit({
				action: AuditAction.ADMIN_GRANT_EXTENSION,
				actorEmail: gate.user.email,
				actorId: gate.user.id,
				metadata: {
					after: parsed.data.submissionExtensionUntil?.toISOString() ?? null,
					before: before.submissionExtensionUntil?.toISOString() ?? null,
				},
				targetId: id,
				targetType: "User",
			})

		return ok({ user: updated })
	},
)
