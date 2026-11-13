import "server-only"
import { headers } from "next/headers"
import type { NextRequest, NextResponse } from "next/server"
import { type ApiErrorBody, fail, withRoute } from "@/lib/api"
import { auth } from "@/lib/auth"
import type { Penalty } from "@/lib/moderation"
import {
	getUserGuardState,
	hasPermission,
	hasRole,
	type Permission,
	type Role,
	type UserGuardState,
} from "@/lib/permissions"

export interface SessionUser {
	email: string
	id: string
	image: string | null
	name: string | null
	/** The IANA zone on file, so the shell only sends the browser's own when it differs. Null until one is captured (see app/api/me/timezone). */
	timezone: string | null
}

export type Guard =
	| { error: NextResponse<ApiErrorBody>; user?: never; roles?: never; penalty?: never }
	| { error?: never; user: SessionUser; roles: Role[]; penalty: Penalty }

async function resolve(): Promise<{ user: SessionUser; roles: Role[]; penalty: Penalty } | null> {
	const session = await auth.api.getSession({ headers: await headers() })
	if (!session) return null
	const u = session.user
	// The cookie cache can serve a session whose user is gone; getUserGuardState answers null for that ghost. Treat it as signed out so handlers answer 401 instead of failing later with a missing-row error.
	// The same read carries the penalty state, so a suspension or ban written mid-session shows up on the next request rather than waiting for the cache to lapse.
	const state: UserGuardState | null = await getUserGuardState(u.id)
	if (!state) return null
	return {
		penalty: state.penalty,
		roles: state.roles,
		user: { email: u.email, id: u.id, image: u.image ?? null, name: u.name ?? null, timezone: u.timezone ?? null },
	}
}

/**
 * Resolve the caller, then refuse a banned account outright.
 *
 * A suspension is read-only, so the read guards below still answer a suspended member. A ban is not: its sessions are revoked, and this check is what makes the refusal hold even for a cookie cache still answering in that window, or if the session rows outlived a failed revoke. Every guard goes through here, so no route can be left reachable by being guarded with the wrong predicate.
 */
async function resolveAllowed(): Promise<Guard> {
	const ctx = await resolve()
	if (!ctx) return { error: fail("UNAUTHENTICATED", "Sign in to continue") }
	if (ctx.penalty === "banned") return { error: fail("ACCOUNT_BANNED", "Your account has been banned") }
	return ctx
}

export const requireSession = resolveAllowed

export async function requirePermission(permission: Permission): Promise<Guard> {
	const ctx = await resolveAllowed()
	if (ctx.error) return ctx
	if (!hasPermission(ctx.roles, permission))
		return { error: fail("FORBIDDEN", `Requires the ${permission} permission`) }

	return ctx
}

export async function requireRole(role: Role): Promise<Guard> {
	const ctx = await resolveAllowed()
	if (ctx.error) return ctx
	if (!hasRole(ctx.roles, role)) return { error: fail("FORBIDDEN", `Requires the ${role} role`) }

	return ctx
}

export async function requireActiveSession(): Promise<Guard> {
	const ctx = await resolveAllowed()
	if (ctx.error) return ctx
	if (ctx.penalty === "suspended") return { error: fail("ACCOUNT_SUSPENDED", "Your account is suspended") }
	return ctx
}

/** Methods that cannot write on their own, so a cross-site caller gains nothing by making one. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Whether a browser sent this write from another origin.
 *
 * `Sec-Fetch-Site` is set by the browser from the page that made the request, and a page cannot write it, so it is the one piece of evidence about the caller's origin a forged request cannot fake. Absent means the caller is not a browser – a webhook, a script, an integration – and those cannot carry a member's cookies, so they are left to their own authentication.
 *
 * `same-site` is refused as well, and that is the whole point: `hackclub.com` and `hackclub.dev` are not public suffixes, so every `*.hackclub.com` and `*.hackclub.dev` page counts as same-site with the app – including the unrelated projects sharing `*.k.hackclub.dev`. Browsers send cookies on same-site requests, so accepting them would leave every one of those pages able to write with a signed-in member's session. Only the app calling itself, `same-origin`, is allowed.
 */
function isForeignWrite(req: NextRequest): boolean {
	if (SAFE_METHODS.has(req.method)) return false
	const site = req.headers.get("sec-fetch-site")
	return site !== null && site !== "same-origin"
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
		// Checked before the session is resolved, so a cross-site write cannot even spend a session lookup. The header says where the browser was when it made the request; a signed-in member's cookies ride along regardless, which is what makes this a write with their authority.
		if (isForeignWrite(req)) return fail("FORBIDDEN", "Cross-site requests are not accepted")
		const gate = await resolveGuard()
		if (gate.error) return gate.error
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowing the compiler cannot verify without a runtime check
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

/** A write route any signed-in participant may call, while their penalty state allows acting. */
export function withWriteSession<C extends object = object>(
	handler: GuardedHandler<C>,
): (req: NextRequest, ctx?: C) => Promise<NextResponse> {
	return guardedRoute(requireActiveSession, handler)
}

/** A write route that needs the named staff permission, while their penalty state allows acting. */
export function withWritePermission<C extends object = object>(
	permission: Permission,
	handler: GuardedHandler<C>,
): (req: NextRequest, ctx?: C) => Promise<NextResponse> {
	return guardedRoute(async () => {
		const gate = await requirePermission(permission)
		if (gate.error) return gate
		// A staff member under a penalty is refused the same way: the check is on the person, not the roster seat.
		if (gate.penalty !== "none") return { error: fail("ACCOUNT_SUSPENDED", "Your account is unable to act") }
		return gate
	}, handler)
}
