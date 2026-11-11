"use client"

import type { JustificationRow, JustificationRowMissing } from "@/lib/airtable/unified-justification"

/**
 * The review platform's writes, all through routes that already exist.
 *
 * Nothing new on the server decides anything: a claim, an hours change, a decision or a reversal is the same request the console makes, so every rule those routes enforce holds here too. This file only turns their `{ error: { code, message } }` refusals into thrown messages the UI can show.
 */

export class ReviewApiError extends Error {
	readonly code: string

	constructor(code: string, message: string) {
		super(message)
		this.name = "ReviewApiError"
		this.code = code
	}
}

interface ErrorBody {
	error?: { code?: string; details?: unknown; message?: string }
}

/** The first field-level message out of a zod tree, so "Invalid request" can say which field. */
function firstDetail(details: unknown): string | null {
	if (!details || typeof details !== "object") return null
	const tree = details as { errors?: unknown; properties?: { [_: string]: unknown } }
	if (Array.isArray(tree.errors) && typeof tree.errors[0] === "string") return tree.errors[0]
	for (const [field, child] of Object.entries(tree.properties ?? {})) {
		const inner = firstDetail(child)
		if (inner) return `${field}: ${inner}`
	}
	return null
}

export async function request<T = unknown>(
	url: string,
	init: { body?: unknown; keepalive?: boolean; method?: "GET" | "POST" | "DELETE" | "PATCH" } = {},
): Promise<T> {
	let response: Response
	try {
		response = await fetch(url, {
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			credentials: "same-origin",
			headers: {
				Accept: "application/json",
				...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
			},
			keepalive: init.keepalive,
			method: init.method ?? "POST",
		})
	} catch {
		throw new ReviewApiError("NETWORK", "Couldn't reach Half Life, check your connection")
	}
	let parsed: unknown = {}
	try {
		parsed = await response.json()
	} catch {
		// A body that is not JSON reads as no body: the status alone says what happened.
	}
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route's own JSON; its shape is the route's contract, checked by verify:contracts
	const data = parsed as ErrorBody & T
	if (!response.ok) {
		const detail = firstDetail(data.error?.details)
		const message = data.error?.message ?? `Request failed (${response.status})`
		throw new ReviewApiError(data.error?.code ?? String(response.status), detail ? `${message} – ${detail}` : message)
	}
	return data
}

export const claim = (submissionId: string): Promise<{ expiresAt: string }> =>
	request(`/api/review/submissions/${encodeURIComponent(submissionId)}/claim`)

export const release = (submissionId: string, keepalive = false): Promise<unknown> =>
	request(`/api/review/submissions/${encodeURIComponent(submissionId)}/claim`, { keepalive, method: "DELETE" })

/** Hand a claim back without caring whether it lands: leaving the screen or skipping must not stall on it, and the claim expires on its own anyway. */
export async function releaseQuietly(submissionId: string, keepalive = false): Promise<void> {
	try {
		await release(submissionId, keepalive)
	} catch {
		// See above: a lost release only means the claim times out.
	}
}

export const saveSessionHours = (
	entry: { comments: string; hoursApproved: number; id: string },
	keepalive = false,
): Promise<unknown> =>
	request("/api/review/hours", {
		body: {
			decisions: [{ comments: entry.comments, hoursApproved: entry.hoursApproved, id: entry.id, kind: "session" }],
		},
		keepalive,
	})

export type DecisionBody =
	| {
			deflationReason?: string
			feedback: string
			grantUsdOverride?: number
			hoursOverride?: number
			reason?: string
			result: "APPROVED"
			technicalFeatures?: string
			tier?: number
	  }
	| { feedback: string; reason?: string; result: "RETURNED" }
	| { feedback: string; reason: string; result: "REJECTED" }

export const decide = (submissionId: string, body: DecisionBody): Promise<unknown> =>
	request(`/api/review/submissions/${encodeURIComponent(submissionId)}/decision`, { body })

/** The submission's Airtable row as an approval would find it, for the unified-justification preview. */
export const justificationRow = (
	submissionId: string,
): Promise<{ missing: JustificationRowMissing | null; row: JustificationRow }> =>
	request(`/api/reviews/${encodeURIComponent(submissionId)}/justification`, { method: "GET" })

export const overrideDecision = (
	projectId: string,
	body: { action: "unapprove" | "reopen"; phase: "DESIGN" | "BUILD"; reason: string },
): Promise<unknown> => request(`/api/admin/theme-projects/${encodeURIComponent(projectId)}/override`, { body })

export const replyToDispute = (disputeId: string, body: string): Promise<unknown> =>
	request(`/api/admin/disputes/${encodeURIComponent(disputeId)}/messages`, { body: { body } })

export const closeDispute = (disputeId: string): Promise<unknown> =>
	request(`/api/admin/disputes/${encodeURIComponent(disputeId)}/close`)

export const sendDisputeBack = (disputeId: string): Promise<unknown> =>
	request(`/api/admin/disputes/${encodeURIComponent(disputeId)}/send-back`)
