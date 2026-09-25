import "server-only"
import { headers } from "next/headers"
import type { NextResponse } from "next/server"
import { type ApiErrorBody, fail } from "@/lib/api"
import { auth } from "@/lib/auth"
import { getUserRoles, hasAnyPermission, hasPermission, hasRole, type Permission, type Role } from "@/lib/permissions"

export interface SessionUser {
  id: string
  email: string
  name: string | null
  image: string | null
}

export type Guard =
  | { error: NextResponse<ApiErrorBody>; user?: never; roles?: never }
  | { error?: never; user: SessionUser; roles: Role[] }

async function resolve(): Promise<{ user: SessionUser; roles: Role[] } | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null
  const u = session.user
  return {
    user: { id: u.id, email: u.email, name: u.name ?? null, image: u.image ?? null },
    roles: await getUserRoles(u.id),
  }
}

export async function requireSession(): Promise<Guard> {
  const ctx = await resolve()
  if (!ctx) return { error: fail("UNAUTHENTICATED", "Sign in to continue") }
  return ctx
}

export async function requirePermission(permission: Permission): Promise<Guard> {
  const ctx = await resolve()
  if (!ctx) return { error: fail("UNAUTHENTICATED", "Sign in to continue") }
  if (!hasPermission(ctx.roles, permission)) {
    return { error: fail("FORBIDDEN", `Requires the ${permission} permission`) }
  }
  return ctx
}

export async function requireAnyPermission(...permissions: Permission[]): Promise<Guard> {
  const ctx = await resolve()
  if (!ctx) return { error: fail("UNAUTHENTICATED", "Sign in to continue") }
  if (!hasAnyPermission(ctx.roles, permissions)) {
    return { error: fail("FORBIDDEN", `Requires one of: ${permissions.join(", ")}`) }
  }
  return ctx
}

export async function requireRole(role: Role): Promise<Guard> {
  const ctx = await resolve()
  if (!ctx) return { error: fail("UNAUTHENTICATED", "Sign in to continue") }
  if (!hasRole(ctx.roles, role)) {
    return { error: fail("FORBIDDEN", `Requires the ${role} role`) }
  }
  return ctx
}

/** Optional session, for routes that behave differently when signed in. */
export async function optionalSession(): Promise<{ user: SessionUser; roles: Role[] } | null> {
  return resolve()
}
