/**
 * Sending a file, and reporting how much of it has gone.
 *
 * XMLHttpRequest rather than fetch, because fetch still cannot report upload progress in any browser this audience uses – and a phone sending a minute of video over school wifi needs to show it is moving, or it looks frozen and gets closed.
 */

export interface UploadResponse {
	json: unknown
	ok: boolean
	status: number
}

/** PUT a file straight to the bucket, with the same progress reporting as a form upload. */
export function putFile(url: string, file: Blob, onProgress?: (fraction: number) => void): Promise<UploadResponse> {
	const { promise, resolve, reject } = Promise.withResolvers<UploadResponse>()
	const xhr = new XMLHttpRequest()
	xhr.open("PUT", url)
	// What R2 stores as the object's type. The presigned URL does not enforce this value (measured), so `/confirm` checks the stored type before anything can point at the object.
	xhr.setRequestHeader("Content-Type", file.type)
	if (onProgress) {
		xhr.upload.addEventListener("progress", e => {
			if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total))
		})
		xhr.upload.addEventListener("load", () => onProgress(1))
	}
	xhr.addEventListener("load", () => {
		let json: unknown = null
		try {
			json = JSON.parse(xhr.responseText)
		} catch {
			json = null
		}
		resolve({ json, ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status })
	})
	// Status 0 is the network/CORS case, where there is no response at all to read. The caller falls back to the form route rather than treating it as a refusal.
	xhr.addEventListener("error", () => resolve({ json: null, ok: false, status: 0 }))
	xhr.addEventListener("abort", () => reject(new Error("The upload was cancelled.")))
	xhr.send(file)
	return promise
}

/**
 * POST a form and report how much of it has been sent.
 *
 * `onProgress` gets the fraction sent, 0 to 1. It reaches 1 when the last byte leaves, which is before the server has stored the file, so a caller should treat 1 as "finishing" rather than "done" until this resolves.
 */
export function postForm(
	url: string,
	body: FormData,
	onProgress?: (fraction: number) => void,
): Promise<UploadResponse> {
	const { promise, resolve, reject } = Promise.withResolvers<UploadResponse>()
	const xhr = new XMLHttpRequest()
	xhr.open("POST", url)
	xhr.responseType = "text"
	if (onProgress) {
		xhr.upload.addEventListener("progress", e => {
			if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total))
		})
		xhr.upload.addEventListener("load", () => onProgress(1))
	}
	xhr.addEventListener("load", () => {
		let json: unknown = null
		try {
			json = JSON.parse(xhr.responseText)
		} catch {
			json = null
		}
		resolve({ json, ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status })
	})
	xhr.addEventListener("error", () =>
		reject(new Error("The upload did not get through. Check your connection and try again.")),
	)
	xhr.addEventListener("abort", () => reject(new Error("The upload was cancelled.")))
	xhr.send(body)
	return promise
}

/**
 * What a failed upload should say.
 *
 * 524 is Cloudflare giving up on the origin while a body is still arriving; it is not the bucket's fault and there is nothing to retry into, so the advice is to send less or get a better connection. The JSON body of an ordinary API failure is prose the server already wrote for a person, so that wins when it exists.
 */
export function uploadFailure(res: UploadResponse): string {
	if (res.status === 524 || res.status === 504)
		return "That upload took too long. Try a shorter clip or a smaller picture, or move somewhere with a better connection."
	const payload = res.json as { error?: { message?: string } } | null
	return payload?.error?.message ?? `Upload failed (${res.status})`
}

/** The same message, for a `fetch` response whose body has not been read yet. */
export async function uploadFailureFrom(response: Response): Promise<string> {
	// A 524 from the edge is HTML, and `json()` on it would throw rather than tell us anything.
	const json: unknown = await response.json().catch(() => null)
	return uploadFailure({ json, ok: response.ok, status: response.status })
}

/**
 * Whether a 404 or 405 means "this deployment has no such route" rather than an answer from the app.
 *
 * The difference decides whether to fall back to the old upload path: our routes answer even a refused token as JSON, while a deployment built before the direct path existed gets Next's HTML "not found". Falling back on the JSON case would make a phone with an expired code send its whole video through the origin before it was told the link had expired.
 */
export function routeMissing(response: Response): boolean {
	if (response.status !== 404 && response.status !== 405) return false
	return !(response.headers.get("content-type") ?? "").includes("application/json")
}
