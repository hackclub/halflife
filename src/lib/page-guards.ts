import "server-only"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { cache } from "react"
import { auth } from "@/lib/auth"
import type { SessionUser } from "@/lib/guards"
import { getUserRoles, hasAnyPermission, hasPermission, type Permission, type Role } from "@/lib/permissions"

export interface PageContext {
  user: SessionUser
  roles: Role[]
}

/**
 * Page-level guards live apart from the route-handler ones because they fail
 * differently: a page redirects or 404s, a handler returns JSON. Doing this in
 * a server component (rather than a `'use client'` layout that fetches roles)
 * is what removes the auth flash and stops an unauthorised page from rendering
 * at all.
 */
//
// Once per request: the layout and the page both ask, and each asking was
// three serial queries against a remote database. React's `cache` scopes the
// answer to one server render, so a sign-out still takes effect on the next.
export const requireSessionPage = cache(async (): Promise<PageContext> => {
  const session = await auth.api.getSession({ headers: await headers() })
  // Via /signed-out, which clears a dead session cookie on the way to the
  // landing page; see that route for why it cannot be `/` directly.
  if (!session) redirect("/signed-out")
  const u = session.user
  return {
    user: { id: u.id, email: u.email, name: u.name ?? null, image: u.image ?? null },
    roles: await getUserRoles(u.id),
  }
})

/**
 * 404 rather than 403: don't confirm that /admin exists to someone guessing
 * at URLs.
 */
export async function requirePermissionPage(permission: Permission): Promise<PageContext> {
  const ctx = await requireSessionPage()
  if (!hasPermission(ctx.roles, permission)) notFound()
  return ctx
}

export async function requireAnyPermissionPage(...permissions: Permission[]): Promise<PageContext> {
  const ctx = await requireSessionPage()
  if (!hasAnyPermission(ctx.roles, permissions)) notFound()
  return ctx
}
