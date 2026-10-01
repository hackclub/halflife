/**
 * POST a form and report how much of it has been sent.
 *
 * XMLHttpRequest rather than fetch, because fetch still cannot report upload
 * progress in any browser this audience uses — and a phone sending a minute of
 * video over school wifi needs to show it is moving, or it looks frozen and
 * gets closed.
 *
 * `onProgress` gets the fraction sent, 0 to 1. It reaches 1 when the last byte
 * leaves, which is before the server has stored the file, so a caller should
 * treat 1 as "finishing" rather than "done" until this resolves.
 */
export function postForm(
	url: string,
	body: FormData,
	onProgress?: (fraction: number) => void,
): Promise<{ ok: boolean; status: number; json: unknown }> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest()
		xhr.open("POST", url)
		xhr.responseType = "text"
		if (onProgress) {
			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total))
			}
			xhr.upload.onload = () => onProgress(1)
		}
		xhr.onload = () => {
			let json: unknown = null
			try {
				json = JSON.parse(xhr.responseText)
			} catch {
				json = null
			}
			resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, json })
		}
		xhr.onerror = () => reject(new Error("The upload did not get through. Check your connection and try again."))
		xhr.onabort = () => reject(new Error("The upload was cancelled."))
		xhr.send(body)
	})
}
