import { describe, expect, test } from "bun:test"
import { type UploadResponse, uploadFailure, uploadFailureFrom } from "@/lib/upload-progress"

function failure(status: number, json: unknown = null): UploadResponse {
	return { json, ok: false, status }
}

/**
 * A timeout means three very different things depending on which request ran out of time.
 *
 * The stage is the whole point: "send a shorter clip" is good advice only when the clip itself was still going through the origin, and misleading when the bytes never left or were already in the bucket.
 */
describe("uploadFailure", () => {
	test("a body that timed out on the slow path explains why it was slow", () => {
		const message = uploadFailure(failure(524), { fallback: "direct-unreachable", stage: "send" })
		expect(message).toContain("HTTP 524")
		expect(message).toContain("could not reach our file store directly")
		expect(message).toContain("shorter clip")
	})

	test("a body that timed out without a direct attempt still names the server path", () => {
		const message = uploadFailure(failure(504), { stage: "send" })
		expect(message).toContain("HTTP 504")
		expect(message).toContain("went through our server")
	})

	test("a presign timeout does not blame the file's size", () => {
		const message = uploadFailure(failure(524), { stage: "prepare" })
		expect(message).toContain("get the upload ready")
		expect(message).toContain("HTTP 524")
		expect(message).not.toContain("shorter clip")
	})

	test("a confirm timeout says the file arrived", () => {
		const message = uploadFailure(failure(524), { stage: "confirm" })
		expect(message).toContain("file was sent")
		expect(message).toContain("HTTP 524")
		expect(message).not.toContain("shorter clip")
	})

	test("a server's own message wins over the status", () => {
		expect(
			uploadFailure(failure(504, { error: { message: "The upload took too long to store." } }), { stage: "send" }),
		).toBe("The upload took too long to store.")
	})

	test("a refusal that is not a timeout falls back to the status", () => {
		expect(uploadFailure(failure(413), { stage: "send" })).toBe("Upload failed (413)")
	})
})

describe("uploadFailureFrom", () => {
	test("reads a timeout with no JSON body", async () => {
		const response = new Response("<html>cloudflare</html>", { status: 524 })
		expect(await uploadFailureFrom(response, { stage: "prepare" })).toContain("get the upload ready")
	})
})
