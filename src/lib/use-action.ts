"use client"

import { useRouter } from "next/navigation"
import { type Dispatch, type SetStateAction, useCallback, useState } from "react"

/**
 * One place for the "POST some JSON, show the server's complaint if it refused" loop that every form on the staff side was writing out by hand.
 *
 * ## The response shape
 *
 * A successful response from this API is the payload itself. There is no `data` envelope – `ok()` in lib/api.ts calls `NextResponse.json(body)` directly, and only `fail()` wraps, in `{ error: { code, message } }`. So the message to show is read off `error.message` and the data is read off the top level.
 *
 * ## Why the error text is uniform
 *
 * A failed `fetch` throws a TypeError whose message is "Failed to fetch", which is a browser's internal wording rather than anything a maker can act on. Forms were split between showing that and showing nothing at all, so this settles on one sentence that means something: the request never arrived.
 */

interface SendOptions {
	/** Serialised as JSON. Omit for a request with no body. */
	body?: unknown
	method?: "POST" | "PATCH" | "PUT" | "DELETE"
}

export type SendResult<T> = { ok: true; data: T } | { ok: false; message: string }

/**
 * Send a JSON request and reduce the response to either its payload or a sentence fit to show a person.
 *
 * The status is only used when the body carried no message of its own, so an API that explains itself is never overwritten by a generic one.
 */
export async function sendJson<T = unknown>(url: string, options: SendOptions = {}): Promise<SendResult<T>> {
	const { method = "POST", body } = options
	let res: Response
	try {
		res = await fetch(url, {
			body: body === undefined ? undefined : JSON.stringify(body),
			headers: body === undefined ? undefined : { "Content-Type": "application/json" },
			method,
		})
	} catch {
		return { message: "Could not reach the server", ok: false }
	}

	// A proxy or a crash can answer with HTML or nothing, so the body is allowed to be unparseable rather than treated as a bug here.
	const payload = (await res.json().catch(() => null)) as ({ error?: { message?: string } } & T) | null

	if (!res.ok) {
		return { message: payload?.error?.message ?? `Request failed (${res.status})`, ok: false }
	}
	return { data: (payload ?? {}) as T, ok: true }
}

/**
 * The busy/error pair every form kept, plus the `router.refresh()` that re-reads the server components this mutation invalidated.
 *
 * `busy` is the key of the action in flight rather than a boolean, because several of these forms have one button per row – a shop item's cost and each of its region prices. A boolean would let the other buttons stay live and a second request race the first; comparing the key tells a row whether *its own* save is running, and `busy !== null` still answers "is anything running" for a single-button form.
 *
 * `after` runs on success and before the refresh, for the local state a successful save implies – clearing the fields, or recording what the server said.
 */
export function useAction(): {
	busy: string | null
	error: string | null
	run: <T = unknown>(key: string, send: () => Promise<SendResult<T>>, after?: (data: T) => void) => Promise<void>
	refuse: (message: string) => void
	setError: Dispatch<SetStateAction<string | null>>
} {
	const router = useRouter()
	const [busy, setBusy] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const run = useCallback(
		async <T = unknown>(key: string, send: () => Promise<SendResult<T>>, after?: (data: T) => void) => {
			setBusy(key)
			setError(null)
			try {
				const result = await send()
				if (!result.ok) {
					setError(result.message)
					return
				}
				after?.(result.data)
				// The data on screen came from the server, so re-reading it is the whole update path.
				router.refresh()
			} finally {
				setBusy(null)
			}
		},
		[router],
	)

	/** Let a form refuse a request itself – a value that has not been typed yet, say – and say why. */
	const refuse = useCallback((message: string) => setError(message), [])

	return { busy, error, refuse, run, setError }
}
