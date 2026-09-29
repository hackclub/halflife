import "server-only"
import { Role } from "@/app/generated/prisma/enums"
import prisma from "@/lib/prisma"

export { Role }

export enum Permission {
  /** Claim and decide design/build submissions. */
  REVIEW_SUBMISSIONS = "REVIEW_SUBMISSIONS",
  /** Approve or override journal-session and Hackatime hours. */
  REVIEW_HOURS = "REVIEW_HOURS",
  /** Un-approve or reopen a decided phase. Deliberately narrower than reviewing. */
  OVERRIDE_DECISIONS = "OVERRIDE_DECISIONS",
  VIEW_USERS = "VIEW_USERS",
  MANAGE_USERS = "MANAGE_USERS",
  MANAGE_ROLES = "MANAGE_ROLES",
  MANAGE_CREDIT = "MANAGE_CREDIT",
  MANAGE_SHOP = "MANAGE_SHOP",
  FULFILL_ORDERS = "FULFILL_ORDERS",
  MANAGE_PROGRAM = "MANAGE_PROGRAM",
  VIEW_AUDIT_LOG = "VIEW_AUDIT_LOG",
  /** Read the upload bucket index; no mutation permission is implied. */
  VIEW_UPLOADS = "VIEW_UPLOADS",
  /**
   * Post announcements to the feed, and hide reels or comments.
   *
   * Deliberately not given to REVIEWER, the volume role: moderating what a
   * 13-18 audience sees is a different kind of trust from deciding whether a
   * PCB was designed well, and the roles below are sized for the second.
   */
  MANAGE_FEED = "MANAGE_FEED",
}

/**
 * Participants hold no role rows at all — absence of a role is the participant
 * state, which keeps the common case free of writes at signup.
 *
 * REVIEWER is the volume role and deliberately cannot mint credit, change
 * roles, or reverse a decision. FULFILLER exists because shipping hardware is
 * done by a larger, lower-trust group than reviewing. AUDITOR is a read-only
 * seat for oversight that isn't ADMIN.
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

export function hasPermission(roles: Role[], permission: Permission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission))
}

export function hasAnyPermission(roles: Role[], permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(roles, p))
}

export function hasRole(roles: Role[], role: Role): boolean {
  return roles.includes(role)
}

export async function getUserRoles(userId: string): Promise<Role[]> {
  const rows = await prisma.userRole.findMany({
    where: { userId },
    select: { role: true },
  })
  return rows.map((r) => r.role)
}

/**
 * Roles for a user that still exists, or `null` when the row is gone.
 *
 * A session can outlive its user. The session cookie cache answers
 * `getSession` without touching the database for up to five minutes, so a
 * user deleted inside that window — by hand, or wholesale by a database
 * reset — still looks signed in, and every page then loads that user by id.
 * One query answers both "who are they" and "are they still here", so the
 * guards can turn a ghost session into a sign-out rather than let the first
 * `findUniqueOrThrow` discover it as a 500.
 */
export async function getUserRolesIfExists(userId: string): Promise<Role[] | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { roles: { select: { role: true } } },
  })
  return user ? user.roles.map((r) => r.role) : null
}
