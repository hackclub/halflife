import "server-only"
import { headers } from "next/headers"
import type { NextRequest, NextResponse } from "next/server"
import { type ApiErrorBody, fail, withRoute } from "@/lib/api"
import { auth } from "@/lib/auth"
import { getUserRolesIfExists, hasPermission, hasRole, type Permission, type Role } from "@/lib/permissions"

export interface SessionUser {
	email: string
	id: string
	image: string | null
	name: string | null
	/** The IANA zone on file, so the shell only sends the browser's own when it differs. Null until one is captured (see app/api/me/timezone). */
	timezone: string | null
}

export type Guard =
	| { error: NextResponse<ApiErrorBody>; user?: never; roles?: never }
	| { error?: never; user: SessionUser; roles: Role[] }

async function resolve(): Promise<{ user: SessionUser; roles: Role[] } | null> {
	const session = await auth.api.getSession({ headers: await headers() })
	if (!session) return null
	const u = session.user
	// The cookie cache can serve a session whose user is gone; see getUserRolesIfExists. Treat that ghost as signed out so handlers answer 401 instead of failing later with a missing-row error.
	const roles = await getUserRolesIfExists(u.id)
	if (roles === null) return null
	return {
		roles,
		user: { email: u.email, id: u.id, image: u.image ?? null, name: u.name ?? null, timezone: u.timezone ?? null },
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
	if (!hasPermission(ctx.roles, permission))
		return { error: fail("FORBIDDEN", `Requires the ${permission} permission`) }

	return ctx
}

export async function requireRole(role: Role): Promise<Guard> {
	const ctx = await resolve()
	if (!ctx) return { error: fail("UNAUTHENTICATED", "Sign in to continue") }
	if (!hasRole(ctx.roles, role)) return { error: fail("FORBIDDEN", `Requires the ${role} role`) }

	return ctx
}

/**
 * The gate every authenticated route opens with, made structural rather than copy-pasted.
 *
 * A hundred handlers wrote the same two lines – `requireSession` and `if (gate.error) return gate.error` – which is only worth having in one place if it is in one place: a route that forgets the check is a public endpoint with the whole account's read access. The wrapper resolves the guard before the handler runs and hands it in as `ctx.gate`, so a handler body starts at its actual work.
 *
 * The request context keeps its Next shape, with `gate` added: a dynamic route destructures `{ params, gate }`, a static one `{ gate }`.
 */
export interface AuthedContext {
	gate: Extract<Guard, { user: SessionUser }>
}

type GuardedHandler<C extends object> = (req: NextRequest, ctx: C & AuthedContext) => Promise<NextResponse>

function guardedRoute<C extends object = object>(
	resolveGuard: () => Promise<Guard>,
	handler: GuardedHandler<C>,
): (req: NextRequest, ctx?: C) => Promise<NextResponse> {
	// The guard sits inside `withRoute`, not in front of it: a thrown session lookup is the same unhandled rejection as a thrown handler, and should become the same logged 500 rather than escaping the wrapper.
	return withRoute(async (req: NextRequest, ctx?: C) => {
		const gate = await resolveGuard()
		if (gate.error) return gate.error
		return handler(req, { ...(ctx as C), gate })
	})
}

/** A route any signed-in participant may call. */
export function withSession<C extends object = object>(
	handler: GuardedHandler<C>,
): (req: NextRequest, ctx?: C) => Promise<NextResponse> {
	return guardedRoute(requireSession, handler)
}

/** A route that needs the named staff permission. */
export function withPermission<C extends object = object>(
	permission: Permission,
	handler: GuardedHandler<C>,
): (req: NextRequest, ctx?: C) => Promise<NextResponse> {
	return guardedRoute(() => requirePermission(permission), handler)
}

/** A route that needs one of the named roles. */
export function withRole<C extends object = object>(
	role: Role,
	handler: GuardedHandler<C>,
): (req: NextRequest, ctx?: C) => Promise<NextResponse> {
	return guardedRoute(() => requireRole(role), handler)
}
