import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { hasRole, Permission, Role } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { getUserDetail } from "@/lib/queries/admin"
import { userFlagsSchema } from "@/lib/schemas/admin"

type Params = { params: Promise<{ id: string }> }

export const dynamic = "force-dynamic"

export const GET = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.VIEW_USERS)
	if (gate.error) return gate.error
	const { id } = await params

	const detail = await getUserDetail(id, {
		includeSensitive: hasRole(gate.roles, Role.ADMIN) || hasRole(gate.roles, Role.AUDITOR),
	})
	if (!detail) return fail("NOT_FOUND", "User not found")
	return ok(detail)
})

export const PATCH = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.MANAGE_USERS)
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, userFlagsSchema)
	if (parsed.error) return parsed.error

	const before = await prisma.user.findUnique({
		where: { id },
		select: { fraudFlagged: true, submissionExtensionUntil: true, email: true },
	})
	if (!before) return fail("NOT_FOUND", "User not found")

	// `User.email` has a plain btree unique index, which is case-SENSITIVE: two spellings of one address are two legal rows to Postgres. The address is stored exactly as typed (see the schema), so the duplicate check has to be the case-insensitive one or `Ada@x.com` and `ada@x.com` could both become accounts - and better-auth would then resolve either spelling to whichever row it found first.
	const emailChanged = parsed.data.email !== undefined && parsed.data.email !== before.email
	if (emailChanged) {
		const taken = await prisma.user.findFirst({
			// `id: { not: id }` so retyping this user's own address with different capitalisation is a rewrite of their row, not a collision with it - the insensitive comparison would otherwise match the user against themselves.
			where: { id: { not: id }, email: { equals: parsed.data.email, mode: "insensitive" } },
			select: { id: true },
		})
		if (taken) return fail("CONFLICT", "Another user already has that email address")
	}

	const updated = await prisma.user.update({
		where: { id },
		data: {
			...(parsed.data.fraudFlagged !== undefined ? { fraudFlagged: parsed.data.fraudFlagged } : {}),
			...(parsed.data.submissionExtensionUntil !== undefined
				? { submissionExtensionUntil: parsed.data.submissionExtensionUntil }
				: {}),
			...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
			// Provenance is withdrawn with the address. Until now `email` was only ever written by an identity provider, so `findUserByEmail` matching it meant the address genuinely belonged to the HCA identity signing in - and better-auth's implicit account linking (lib/auth.ts trusts the hca provider, and `requireLocalEmailVerified` defaults true) will attach an incoming HCA identity to ANY row whose address matches when that row is `emailVerified`. An address a human typed into the admin panel has no such proof, so leaving the flag set would let whoever controls it sign in and be linked onto this account. Clearing it closes that: the next sign-in still works, because it resolves on the HCA account row (providerId + sub) rather than on the address.
			...(emailChanged ? { emailVerified: false } : {}),
		},
		select: { id: true, fraudFlagged: true, submissionExtensionUntil: true, email: true, emailVerified: true },
	})

	if (parsed.data.fraudFlagged !== undefined && parsed.data.fraudFlagged !== before.fraudFlagged) {
		await logAudit({
			action: parsed.data.fraudFlagged ? AuditAction.ADMIN_FLAG_FRAUD : AuditAction.ADMIN_UNFLAG_FRAUD,
			actorId: gate.user.id,
			actorEmail: gate.user.email,
			targetType: "User",
			targetId: id,
			metadata: { before: before.fraudFlagged, after: parsed.data.fraudFlagged },
		})
	}
	if (emailChanged) {
		await logAudit({
			action: AuditAction.ADMIN_CHANGE_EMAIL,
			actorId: gate.user.id,
			actorEmail: gate.user.email,
			targetType: "User",
			targetId: id,
			metadata: { before: before.email, after: parsed.data.email, emailVerified: false },
		})
	}
	if (parsed.data.submissionExtensionUntil !== undefined) {
		await logAudit({
			action: AuditAction.ADMIN_GRANT_EXTENSION,
			actorId: gate.user.id,
			actorEmail: gate.user.email,
			targetType: "User",
			targetId: id,
			metadata: {
				before: before.submissionExtensionUntil?.toISOString() ?? null,
				after: parsed.data.submissionExtensionUntil?.toISOString() ?? null,
			},
		})
	}

	return ok({ user: updated })
})
