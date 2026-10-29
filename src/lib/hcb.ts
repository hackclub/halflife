import "server-only"
import { z } from "zod"
import { HttpError } from "@/lib/errors"
import { isRecord } from "@/lib/unknown"

/**
 * HCB's v4 API – the authenticated, write-capable one.
 *
 * The v3 API behind /docs/api/v3 is read-only and unauthenticated; it cannot send money. Grants are paid by topping up a participant's existing HCB card grant, which is what `hackclub/dinobags` does with this same API:
 *
 *   POST /api/v4/card_grants/{hashid}/topup?expand=disbursements,user
 *   PUT  /api/v4/organizations/{slug}/transactions/{txn_id}
 *
 * Auth is an OAuth bearer. Either a static `HCB_ACCESS_TOKEN`, or the refresh-token flow (`HCB_CLIENT_ID` / `HCB_CLIENT_SECRET` / `HCB_REFRESH_TOKEN`), with the app invited to the org as a manager. The app needs `card_grants:write` to top up, and `card_grants:read` to check what a lost response left behind. Unconfigured, this module refuses rather than calling anything.
 */

const DEFAULT_BASE = "https://hcb.hackclub.com"

/** The parts of HCB's JSON this module reads. Parsed at the boundary rather than asserted, because a shape change here moves money. */
const TokenBody = z.object({
	access_token: z.string().optional(),
	expires_in: z.number().optional(),
	refresh_token: z.string().optional(),
})
const CardGrantBody = z.object({
	amount_cents: z.number().optional(),
	card_id: z.string().nullish(),
	created_at: z.string().nullish(),
	disbursements: z
		.array(
			z.object({
				id: z.string().nullish(),
				transaction_id: z.string().nullish(),
			}),
		)
		.optional(),
	email: z.string().nullish(),
	id: z.string().optional(),
	purpose: z.string().nullish(),
	status: z.string().optional(),
	user: z.object({ email: z.string().nullish() }).nullish(),
})

function base(): string {
	return (process.env.HCB_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "")
}

function orgSlug(): string {
	const slug = process.env.HCB_ORG_SLUG
	if (!slug) throw new HttpError("NOT_CONFIGURED", "HCB_ORG_SLUG is not set")
	return slug
}

export function isHcbConfigured(): boolean {
	const staticToken = Boolean(process.env.HCB_ACCESS_TOKEN)
	const refreshable = Boolean(
		process.env.HCB_CLIENT_ID && process.env.HCB_CLIENT_SECRET && process.env.HCB_REFRESH_TOKEN,
	)
	return Boolean(process.env.HCB_ORG_SLUG && (staticToken || refreshable))
}

let cachedToken: { token: string; expiresAt: number } | null = null

/** Refresh a little before expiry, so an in-flight call cannot ride off a cliff. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000

async function accessToken(force = false): Promise<string> {
	if (process.env.HCB_ACCESS_TOKEN) return process.env.HCB_ACCESS_TOKEN
	if (!force && cachedToken && cachedToken.expiresAt > Date.now() + TOKEN_EXPIRY_MARGIN_MS) return cachedToken.token

	const id = process.env.HCB_CLIENT_ID
	const secret = process.env.HCB_CLIENT_SECRET
	const refresh = process.env.HCB_REFRESH_TOKEN
	if (!id || !secret || !refresh) throw new HttpError("NOT_CONFIGURED", "HCB is not configured on this deployment")

	const res = await fetch(`${base()}/api/v4/oauth/token`, {
		body: new URLSearchParams({
			client_id: id,
			client_secret: secret,
			grant_type: "refresh_token",
			redirect_uri: process.env.HCB_REDIRECT_URI ?? "",
			refresh_token: refresh,
		}),
		headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
		method: "POST",
		signal: AbortSignal.timeout(15_000),
	})
	if (!res.ok) throw new HttpError("INTERNAL", `HCB token refresh failed (${res.status})`)

	const data = TokenBody.parse(await res.json())
	if (!data.access_token) throw new HttpError("INTERNAL", "HCB token refresh returned no access token")
	// Default an hour when HCB does not say; either way the token is now bounded rather than cached for the life of the process.
	const lifetimeMs = (typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 3600) * 1000
	cachedToken = { expiresAt: Date.now() + lifetimeMs, token: data.access_token }
	if (data.refresh_token && data.refresh_token !== refresh)
		// HCB rotates refresh tokens, and an env var cannot be rewritten. This token is used for the life of the process; persisting the new one (see docs) is what keeps the next process able to refresh.
		console.warn("[hcb] refresh token rotated; persist the new value or the next refresh will fail")

	return cachedToken.token
}

/**
 * An HCB request with the current access token, retried once with a fresh one when a 401 says the cached token is stale. A static `HCB_ACCESS_TOKEN` is not refreshable, so a 401 there is returned to the caller untouched.
 */
async function hcbFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
	const { timeoutMs = 15_000, headers, ...rest } = init
	for (let attempt = 0; ; attempt++) {
		const token = await accessToken(attempt > 0)
		const mergedHeaders = new Headers({ accept: "application/json", authorization: `Bearer ${token}` })
		for (const [key, value] of new Headers(headers)) mergedHeaders.set(key, value)
		const res = await fetch(`${base()}${path}`, {
			...rest,
			headers: mergedHeaders,
			signal: AbortSignal.timeout(timeoutMs),
		})
		if (res.status === 401 && attempt === 0 && !process.env.HCB_ACCESS_TOKEN) {
			cachedToken = null
			continue
		}
		return res
	}
}

/** A bare hashid, or a grant link on HCB (or the configured base). */
export function parseGrantHashid(input: string): string | null {
	const value = input.trim()
	if (!value) return null
	if (/^[A-Za-z0-9]{4,32}$/.test(value)) return value

	let url: URL
	try {
		url = new URL(value)
	} catch {
		return null
	}
	const allowed = new URL(base()).hostname
	if (url.hostname !== allowed && !url.hostname.endsWith(".hackclub.com")) return null
	return /\/grants\/([A-Za-z0-9]{4,32})/.exec(url.pathname)?.[1] ?? null
}

/**
 * Whether a grant's card is checked against the maker before it is paid.
 *
 * On by default, and it should stay on: the top-up moves the money as it answers, so a card that belongs to somebody else cannot be recalled afterwards.
 *
 * HCB only renders another account's email to a token that may read it, so a deployment whose token cannot would refuse every grant. `HCB_VERIFY_GRANT_OWNER=false` is the escape hatch for such a deployment - and the trail records that nobody checked.
 */
export function verifiesGrantOwner(): boolean {
	return (process.env.HCB_VERIFY_GRANT_OWNER ?? "true").trim().toLowerCase() !== "false"
}

export interface TopUpResult {
	/**
	 * The email of the account that owns the card grant, as HCB reported it. Null when HCB did not render one.
	 */
	ownerEmail: string | null
	transactionId: string | null
}

/**
 * The email of the account that owns a card grant, lower-cased, or null when HCB did not render one.
 *
 * HCB only renders another account's email to a token that may read it, so a null here means "HCB would not say", not "this grant has no owner". That distinction is the whole point of the function: the caller has to be able to tell an unreadable owner from a wrong one.
 */
function readOwnerEmail(user: { email?: string | null } | null | undefined): string | null {
	const email = user?.email
	if (typeof email !== "string") return null
	const trimmed = email.trim().toLowerCase()
	return trimmed.length > 0 ? trimmed : null
}

export async function topUpCardGrant(grantHashid: string, amountCents: number): Promise<TopUpResult> {
	const res = await hcbFetch(`/api/v4/card_grants/${encodeURIComponent(grantHashid)}/topup?expand=disbursements,user`, {
		body: JSON.stringify({ amount_cents: amountCents }),
		headers: { "content-type": "application/json" },
		method: "POST",
		timeoutMs: 20_000,
	})
	if (!res.ok) {
		const body = await res.text().catch(() => "")
		throw new HttpError("INTERNAL", `HCB refused the top-up (${res.status})`, { detail: body.slice(0, 300) })
	}
	const data = CardGrantBody.parse(await res.json())
	return {
		ownerEmail: readOwnerEmail(data.user),
		transactionId: data.disbursements?.[0]?.transaction_id ?? null,
	}
}

/**
 * Who owns a card grant.
 *
 * Read before a payment rather than after: the top-up moves the money as it answers, so a grant that belongs to somebody else has to be caught before it is paid, not noticed once it has been.
 */
export interface CardGrantOwner {
	/** The owner's email, or null when HCB would not render one. */
	email: string | null
}

export async function readCardGrantOwner(grantHashid: string): Promise<CardGrantOwner> {
	const res = await hcbFetch(`/api/v4/card_grants/${encodeURIComponent(grantHashid)}?expand=user`)
	if (!res.ok) {
		const body = await res.text().catch(() => "")
		throw new HttpError("INTERNAL", `HCB refused to read the grant (${res.status})`, { detail: body.slice(0, 300) })
	}
	const parsed = CardGrantBody.safeParse(await res.json().catch(() => null))
	return { email: readOwnerEmail(parsed.success ? parsed.data.user : null) }
}

export interface GrantDisbursement {
	/** Every HCB disbursement carries an amount; a row without one is not trusted. */
	amountCents: number
	/** ISO timestamp HCB recorded the disbursement at. */
	createdAt: string | null
	memo: string | null
	transactionId: string | null
}

/**
 * The result of reading a grant's disbursements.
 *
 * `unreadable` is not the same as an empty list: an unexpected payload shape (an envelope, a renamed field, a string amount) must never be mistaken for "the previous attempt paid nothing", because that is the state in which a retry sends the money again.
 */
export type GrantDisbursementList = { kind: "listed"; rows: GrantDisbursement[] } | { kind: "unreadable" }

/**
 * Every disbursement on a card grant, newest first: top-ups land as positive amounts, withdrawals as negative.
 *
 * No pagination: a grant only accumulates one row per top-up/withdrawal, and this exists to spot a top-up whose response was lost before deciding whether to send another. Fails closed on any shape it does not recognise – see `GrantDisbursementList`.
 */
export async function listCardGrantDisbursements(grantHashid: string): Promise<GrantDisbursementList> {
	const res = await hcbFetch(`/api/v4/card_grants/${encodeURIComponent(grantHashid)}?expand=disbursements`)
	if (!res.ok) {
		const body = await res.text().catch(() => "")
		throw new HttpError("INTERNAL", `HCB refused to read the grant (${res.status})`, { detail: body.slice(0, 300) })
	}

	const data: unknown = await res.json().catch(() => null)
	const raw = isRecord(data) ? data.disbursements : null
	if (!Array.isArray(raw)) return { kind: "unreadable" }

	const rows: GrantDisbursement[] = []
	for (const entry of raw) {
		if (!isRecord(entry)) return { kind: "unreadable" }
		const d = entry
		if (typeof d.amount_cents !== "number" || !Number.isFinite(d.amount_cents)) return { kind: "unreadable" }
		rows.push({
			amountCents: d.amount_cents,
			createdAt: typeof d.created_at === "string" ? d.created_at : null,
			memo: typeof d.memo === "string" ? d.memo : null,
			transactionId: typeof d.transaction_id === "string" ? d.transaction_id : null,
		})
	}
	return { kind: "listed", rows }
}

/** Allowance for clock skew between our attempt time and HCB's record. */
export const TOPUP_SKEW_MS = 5 * 60_000

/**
 * Decide whether a top-up whose response was lost actually landed.
 *
 * A single disbursement matching the amount at or after the attempt is evidence it did. Several in the window, a candidate with no usable timestamp, or a payload that could not be read at all is not something to guess about: an unnecessary retry pays twice, and a skipped one underpays, so ambiguity goes back to a human.
 */
export function reconcileDisbursement(
	list: GrantDisbursementList,
	amountCents: number,
	attemptedAt: Date,
): { kind: "landed"; transactionId: string | null } | { kind: "absent" } | { kind: "ambiguous" } {
	// Unreadable is not absent. If we could not parse what HCB holds, the only safe answer is to send the admin to look, never to retry the top-up.
	if (list.kind === "unreadable") return { kind: "ambiguous" }

	const sameAmount = list.rows.filter(d => d.amountCents === amountCents)
	if (sameAmount.length === 0) return { kind: "absent" }

	const dated: { at: number; transactionId: string | null }[] = []
	for (const d of sameAmount) {
		const at = d.createdAt ? Date.parse(d.createdAt) : Number.NaN
		if (!Number.isFinite(at)) return { kind: "ambiguous" }
		dated.push({ at, transactionId: d.transactionId })
	}

	const after = attemptedAt.getTime() - TOPUP_SKEW_MS
	const inWindow = dated.filter(d => d.at >= after)
	if (inWindow.length === 1) return { kind: "landed", transactionId: inWindow[0]?.transactionId ?? null }
	if (inWindow.length > 1) return { kind: "ambiguous" }
	return { kind: "absent" }
}

/** A card grant as the organisation list and the create response describe it. */
export interface HcbCardGrantSummary {
	amountCents: number
	cardId: string | null
	createdAt: string | null
	email: string | null
	id: string
	purpose: string | null
	status: string | null
}

const ListedCardGrantBody = CardGrantBody.extend({
	amount_cents: z.number(),
	id: z.string(),
})

function toCardGrantSummary(data: z.infer<typeof ListedCardGrantBody>): HcbCardGrantSummary {
	return {
		amountCents: data.amount_cents,
		cardId: data.card_id ?? null,
		createdAt: data.created_at ?? null,
		email: readOwnerEmail(data.user) ?? readOwnerEmail({ email: data.email }),
		id: data.id,
		purpose: data.purpose ?? null,
		status: data.status ?? null,
	}
}

export type HcbCardGrantList = { kind: "listed"; rows: HcbCardGrantSummary[] } | { kind: "unreadable" }

/**
 * Every card grant the organisation has issued, newest first.
 *
 * This is the only way to find out whether a create whose response was lost actually landed, so an unreadable payload fails closed: “I could not read the list” must never be treated as “there is no match”.
 */
export async function listOrganizationCardGrants(): Promise<HcbCardGrantList> {
	const res = await hcbFetch(
		`/api/v4/organizations/${encodeURIComponent(orgSlug())}/card_grants?expand=disbursements,user`,
	)
	if (!res.ok) {
		const body = await res.text().catch(() => "")
		throw new HttpError("INTERNAL", `HCB refused to list card grants (${res.status})`, { detail: body.slice(0, 300) })
	}

	const data: unknown = await res.json().catch(() => null)
	if (!Array.isArray(data)) return { kind: "unreadable" }

	const rows: HcbCardGrantSummary[] = []
	for (const entry of data) {
		const parsed = ListedCardGrantBody.safeParse(entry)
		if (!parsed.success) return { kind: "unreadable" }
		rows.push(toCardGrantSummary(parsed.data))
	}
	return { kind: "listed", rows }
}

export interface CreateCardGrantInput {
	amountCents: number
	email: string
	instructions: string
	inviteMessage: string
	/** Carries the project marker used to reconcile a lost response. */
	purpose: string
}

/**
 * Issue a card grant from the organisation's balance.
 *
 * A recipient with no HCB account gets an invitation; `cardId` stays null until they activate it, so a null card is a successfully issued grant rather than a failure.
 */
export async function createCardGrant(input: CreateCardGrantInput): Promise<HcbCardGrantSummary> {
	const res = await hcbFetch(`/api/v4/organizations/${encodeURIComponent(orgSlug())}/card_grants`, {
		body: JSON.stringify({
			amount_cents: input.amountCents,
			email: input.email,
			instructions: input.instructions,
			invite_message: input.inviteMessage,
			purpose: input.purpose,
		}),
		headers: { "content-type": "application/json" },
		method: "POST",
		timeoutMs: 20_000,
	})
	if (!res.ok) {
		const body = await res.text().catch(() => "")
		throw new HttpError("INTERNAL", `HCB refused the card grant (${res.status})`, {
			detail: body.slice(0, 300),
			hcbStatus: res.status,
		})
	}

	const parsed = ListedCardGrantBody.safeParse(await res.json().catch(() => null))
	if (!parsed.success)
		throw new HttpError("INTERNAL", "HCB returned a card grant Half Life could not read", {
			detail: z.treeifyError(parsed.error),
		})
	return toCardGrantSummary(parsed.data)
}

/** The organisation's spendable balance, in cents. */
export async function readOrganizationBalanceCents(): Promise<number> {
	const res = await hcbFetch(`/api/v4/organizations/${encodeURIComponent(orgSlug())}`)
	if (!res.ok) {
		const body = await res.text().catch(() => "")
		throw new HttpError("INTERNAL", `HCB refused to read the organisation (${res.status})`, {
			detail: body.slice(0, 300),
		})
	}

	const data: unknown = await res.json().catch(() => null)
	if (!isRecord(data) || typeof data.balance_cents !== "number")
		throw new HttpError("INTERNAL", "HCB did not say the organisation's balance")
	return data.balance_cents
}

/** Cancel a grant, returning its remaining balance to the organisation. */
export async function cancelCardGrant(grantId: string): Promise<void> {
	const res = await hcbFetch(`/api/v4/card_grants/${encodeURIComponent(grantId)}/cancel`, {
		method: "POST",
	})
	if (!res.ok) {
		const body = await res.text().catch(() => "")
		throw new HttpError("INTERNAL", `HCB refused to cancel the card grant (${res.status})`, {
			detail: body.slice(0, 300),
		})
	}
}

/** Allowance for clock skew between our attempt time and HCB's record. */
export const CARD_GRANT_SKEW_MS = 5 * 60_000

export interface CardGrantExpectation {
	amountCents: number
	email: string
	/** The stable `HL:<projectId>` marker written into `purpose`. */
	purpose: string
	attemptedAt: Date
}

/**
 * Decide whether a card grant whose response was lost actually landed.
 *
 * A single matching grant at or after the attempt is evidence it did. Several in the window, a candidate with no usable timestamp, or a payload that could not be read at all is not something to guess about: an unnecessary retry creates a second card, and a skipped one leaves the maker unpaid.
 */
export function reconcileCardGrantIssue(
	list: HcbCardGrantList,
	expected: CardGrantExpectation,
): { kind: "landed"; grantId: string } | { kind: "absent" } | { kind: "ambiguous" } {
	if (list.kind === "unreadable") return { kind: "ambiguous" }

	const email = expected.email.trim().toLowerCase()
	const candidates = list.rows.filter(
		row =>
			row.amountCents === expected.amountCents
			&& row.email?.toLowerCase() === email
			&& row.purpose === expected.purpose,
	)
	if (candidates.length === 0) return { kind: "absent" }

	const dated: { at: number; id: string }[] = []
	for (const row of candidates) {
		const at = row.createdAt ? Date.parse(row.createdAt) : Number.NaN
		if (!Number.isFinite(at)) return { kind: "ambiguous" }
		dated.push({ at, id: row.id })
	}

	const after = expected.attemptedAt.getTime() - CARD_GRANT_SKEW_MS
	const inWindow = dated.filter(row => row.at >= after)
	if (inWindow.length === 1) return { kind: "landed", grantId: inWindow[0]?.id ?? "" }
	if (inWindow.length > 1) return { kind: "ambiguous" }
	return { kind: "absent" }
}

/** Name the resulting transaction, so the org's books say why the money moved. */
export async function memoTransaction(transactionId: string, memo: string): Promise<void> {
	const slug = process.env.HCB_ORG_SLUG
	if (!slug) throw new HttpError("NOT_CONFIGURED", "HCB_ORG_SLUG is not set")
	const res = await hcbFetch(
		`/api/v4/organizations/${encodeURIComponent(slug)}/transactions/${encodeURIComponent(transactionId)}`,
		{
			body: JSON.stringify({ memo }),
			headers: { "content-type": "application/json" },
			method: "PUT",
		},
	)
	if (!res.ok) throw new HttpError("INTERNAL", `HCB memo update failed (${res.status})`)
}
