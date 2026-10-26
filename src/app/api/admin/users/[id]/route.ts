import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { hasRole, Permission, Role } from "@/lib/permissions"
import db, { isUniqueViolation } from "@/lib/prisma8"
import { getUserDetail } from "@/lib/queries/admin"
import { userFlagsSchema } from "@/lib/schemas/admin"
import { escapeLikePattern } from "@/lib/text"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"

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

		const before = await db.orm.public.User.whereUnique({ id })
			.select("email", "fraudFlagged", "submissionExtensionUntil")
			.first()
		if (!before) return fail("NOT_FOUND", "User not found")

		// `User.email` has a plain btree unique index, which is case-SENSITIVE: two spellings of one address are two legal rows to Postgres. The address is stored exactly as typed (see the schema), so the duplicate check has to be the case-insensitive one or `Ada@x.com` and `ada@x.com` could both become accounts - and better-auth would then resolve either spelling to whichever row it found first.
		const nextEmail = parsed.data.email
		const emailChanged = nextEmail !== undefined && nextEmail !== before.email
		if (emailChanged) {
			const taken = await db.orm.public.User.where(user => user.email.ilike(escapeLikePattern(nextEmail)))
				.where(user => user.id.neq(id))
				.select("id")
				.first()
			if (taken) return fail("CONFLICT", "Another user already has that email address")
		}

		let updated: {
			email: string
			emailVerified: boolean
			fraudFlagged: boolean
			id: string
			submissionExtensionUntil: string | null
		}
		try {
			const row = await db.orm.public.User.where({ id })
				.select("email", "emailVerified", "fraudFlagged", "id", "submissionExtensionUntil")
				.update({
					...(parsed.data.fraudFlagged !== undefined ? { fraudFlagged: parsed.data.fraudFlagged } : {}),
					...(parsed.data.submissionExtensionUntil !== undefined
						? {
								submissionExtensionUntil: parsed.data.submissionExtensionUntil
									? formatDbTimestamp(parsed.data.submissionExtensionUntil)
									: null,
							}
						: {}),
					...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
					// Provenance is withdrawn with the address. Until now `email` was only ever written by an identity provider, so `findUserByEmail` matching it meant the address genuinely belonged to the HCA identity signing in - and better-auth's implicit account linking (lib/auth.ts trusts the hca provider, and `requireLocalEmailVerified` defaults true) will attach an incoming HCA identity to ANY row whose address matches when that row is `emailVerified`. An address a human typed into the admin panel has no such proof, so the flag must not stay set for a linked account. Clearing it is the main guard; adoptHcaVerifiedEmail (lib/hca-profile) reinforces it by refusing to re-verify any row that already has a linked Account, though it still repairs account-less staff-import rows - so the flag (not the address) is what separates a typed address from a verified one. The next sign-in still works, because it resolves on the HCA account row (providerId + sub) rather than on the address.
					...(emailChanged ? { emailVerified: false } : {}),
				})
			if (!row) return fail("NOT_FOUND", "User not found")
			updated = {
				...row,
				submissionExtensionUntil: row.submissionExtensionUntil
					? parseDbTimestamp(row.submissionExtensionUntil).toISOString()
					: null,
			}
		} catch (err) {
			// The check above is a read followed by a write, so a sign-in or another admin can take the address in between. Answer with the same conflict the check would have, rather than a 500.
			if (isUniqueViolation(err)) throw new HttpError("CONFLICT", "Another user already has that email address")
			throw err
		}

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
					before: before.submissionExtensionUntil
						? parseDbTimestamp(before.submissionExtensionUntil).toISOString()
						: null,
				},
				targetId: id,
				targetType: "User",
			})

		return ok({ user: updated })
	},
)
