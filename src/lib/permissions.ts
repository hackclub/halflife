import "server-only"
import { Role } from "@/lib/enums"
import { type Penalty, penaltyFor } from "@/lib/moderation"
import db from "@/lib/prisma8"

export { Role } from "@/lib/enums"
export enum Permission {
	FULFILL_ORDERS = "FULFILL_ORDERS",
	MANAGE_CREDIT = "MANAGE_CREDIT",
	/**
	 * Post announcements to the feed, and hide reels or comments.
	 *
	 * Deliberately not given to REVIEWER, the volume role: moderating what a 13-18 audience sees is a different kind of trust from deciding whether a PCB was designed well, and the roles below are sized for the second.
	 */
	MANAGE_FEED = "MANAGE_FEED",
	MANAGE_PROGRAM = "MANAGE_PROGRAM",
	MANAGE_ROLES = "MANAGE_ROLES",
	MANAGE_SHOP = "MANAGE_SHOP",
	MANAGE_USERS = "MANAGE_USERS",
	/** Un-approve or reopen a decided phase. Deliberately narrower than reviewing. */
	OVERRIDE_DECISIONS = "OVERRIDE_DECISIONS",
	/** Approve or override journal-session and Hackatime hours. */
	REVIEW_HOURS = "REVIEW_HOURS",
	/** Claim and decide design/build submissions. */
	REVIEW_SUBMISSIONS = "REVIEW_SUBMISSIONS",
	VIEW_AUDIT_LOG = "VIEW_AUDIT_LOG",
	/** Read the upload bucket index; no mutation permission is implied. */
	VIEW_UPLOADS = "VIEW_UPLOADS",
	VIEW_USERS = "VIEW_USERS",
}

/**
 * Participants hold no role rows at all – absence of a role is the participant state, which keeps the common case free of writes at signup.
 *
 * REVIEWER is the volume role and deliberately cannot mint credit, change roles, or reverse a decision. FULFILLER exists because shipping hardware is done by a larger, lower-trust group than reviewing. AUDITOR is a read-only seat for oversight that isn't ADMIN.
 */
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
	[Role.ADMIN]: Object.values(Permission),
	[Role.REVIEWER]: [Permission.REVIEW_SUBMISSIONS, Permission.REVIEW_HOURS, Permission.VIEW_USERS],
	[Role.FULFILLER]: [Permission.FULFILL_ORDERS, Permission.VIEW_USERS],
	[Role.AUDITOR]: [Permission.VIEW_AUDIT_LOG, Permission.VIEW_USERS, Permission.VIEW_UPLOADS],
}

export function permissionsFor(roles: Role[]): Permission[] {
	const set = new Set<Permission>()
	for (const role of roles) for (const p of ROLE_PERMISSIONS[role] ?? []) set.add(p)
	return [...set]
}

/**
 * How far a set of roles reaches, in one word.
 *
 * This is reach, not trust. The roles are deliberately not a ladder – a REVIEWER and a FULFILLER are different kinds of seat, and `lib/review.ts` says so – but the permissions behind them are comparable, because they are the same thing the guards check. So the level is read off the union of the permissions those roles grant, which is also why somebody holding two roles is described by what the two together allow rather than by either one alone.
 */
export type PermissionLevel = "full" | "write" | "read" | "none"

/** How many permissions there are to have, for saying "3 of 13" rather than "3". */
export const PERMISSION_COUNT = Object.values(Permission).length

/**
 * The permissions that only look.
 *
 * A list rather than a rule, so that a permission added later is reported as `write` until someone says otherwise. Over-reporting what an account can do is the safe direction to be wrong in: the alternative is reading a new read-only permission as an ability to change things, and the display is the thing a staff member trusts about it.
 */
const READ_ONLY_PERMISSIONS = new Set<Permission>([
	Permission.VIEW_AUDIT_LOG,
	Permission.VIEW_UPLOADS,
	Permission.VIEW_USERS,
])

/**
 * What the roles add up to.
 *
 * `full` is the top because MANAGE_ROLES hands out every other permission, including to oneself: it is the only level from which the rest can be reached. `write` is anything that changes the programme without changing who has access to it, `read` is looking without touching, and `none` is a participant, who holds no staff permissions at all – which says nothing about the platform itself, since a participant runs their own projects.
 */
export interface PermissionSummary {
	/** How far those permissions reach. */
	level: PermissionLevel
	/** The permissions the roles grant, in the order the roles list them. */
	permissions: Permission[]
}

/**
 * A permission as a person reads it: `MANAGE_CREDIT` becomes "manage credit".
 *
 * The audit log shows its own enum names raw, but that is a log being looked up; this is somebody being told what an account may do.
 */
export function readablePermission(permission: Permission): string {
	return permission.toLowerCase().replaceAll("_", " ")
}

/**
 * The level a set of roles reaches, and the permissions that get it there.
 *
 * The union of the roles' permissions is the thing `hasPermission` asks about, so it is the thing summarised here: a person with REVIEWER and AUDITOR together is described by what the two together allow.
 */
export function permissionSummary(roles: Role[]): PermissionSummary {
	const permissions = permissionsFor(roles)
	const level: PermissionLevel =
		permissions.length === 0
			? "none"
			: permissions.includes(Permission.MANAGE_ROLES)
				? "full"
				: permissions.every(p => READ_ONLY_PERMISSIONS.has(p))
					? "read"
					: "write"
	return { level, permissions }
}

/** The words the console shows for each level. */
export const PERMISSION_LEVEL_LABELS: Record<PermissionLevel, string> = {
	full: "full access",
	none: "no staff access",
	read: "read only",
	write: "write access",
}

export function hasPermission(roles: Role[], permission: Permission): boolean {
	return roles.some(role => ROLE_PERMISSIONS[role]?.includes(permission))
}

export function hasAnyPermission(roles: Role[], permissions: Permission[]): boolean {
	return permissions.some(p => hasPermission(roles, p))
}

export function hasRole(roles: Role[], role: Role): boolean {
	return roles.includes(role)
}

export async function getUserRoles(userId: string): Promise<Role[]> {
	const rows = await db.orm.public.UserRole.where({ userId }).select("role").all()
	return rows.map(r => r.role)
}

/**
 * Roles for a user that still exists, or `null` when the row is gone.
 *
 * A session can outlive its user. The session cookie cache answers `getSession` without touching the database for up to five minutes, so a user deleted inside that window – by hand, or wholesale by a database reset – still looks signed in, and every page then loads that user by id. One query answers both "who are they" and "are they still here", so the guards can turn a ghost session into a sign-out rather than let the first `findUniqueOrThrow` discover it as a 500.
 */
export async function getUserRolesIfExists(userId: string): Promise<Role[] | null> {
	const user = await db.orm.public.User.whereUnique({ id: userId })
		.include("roles", roles => roles.select("role"))
		.first()
	return user?.roles.map(r => r.role) ?? null
}

/**
 * Roles and penalty state in the same read, for guards that must answer "who" and "may they still act" in one request.
 *
 * Same ghost rule as above: a missing row answers `null`. The penalty timestamps travel with the query because a member's ability to act can be revoked mid-session - a ban written while a session cookie is still in some browser's hands shows up on this very read, so the next request refuses rather than waiting for the cookie cache to lapse.
 */
export interface UserGuardState {
	penalty: Penalty
	roles: Role[]
}

export async function getUserGuardState(userId: string): Promise<UserGuardState | null> {
	const user = await db.orm.public.User.whereUnique({ id: userId })
		.include("roles", roles => roles.select("role"))
		.select("bannedAt", "suspendedUntil")
		.first()
	if (!user) return null
	return {
		penalty: penaltyFor(user.bannedAt ?? null, user.suspendedUntil ?? null),
		roles: user.roles.map(r => r.role),
	}
}
