import { describe, expect, test } from "bun:test"
import { isTransientS3Error } from "@/lib/uploads/r2"

function s3Error(fields: { code?: string; status?: number }): Error {
	return Object.assign(new Error("We encountered an internal error. Please try again."), { name: "S3Error", ...fields })
}

/**
 * Which bucket failures are worth a second attempt, and which are the caller's or the deployment's fault.
 *
 * Getting this wrong either way is visible: a credential refusal retried is a wasted round trip and a misleading "try again" to the participant, and R2's `InternalError` left alone is the stack trace this classification exists to remove.
 */
describe("isTransientS3Error", () => {
	test("treats R2's InternalError as the bucket's own fault", () => {
		expect(isTransientS3Error(s3Error({ code: "InternalError", status: 500 }))).toBe(true)
	})

	test("treats any 5xx from the bucket as worth retrying", () => {
		expect(isTransientS3Error(s3Error({ status: 503 }))).toBe(true)
	})

	test("leaves a rejected credential for the configuration answer", () => {
		expect(isTransientS3Error(s3Error({ code: "AccessDenied", status: 403 }))).toBe(false)
		expect(isTransientS3Error(s3Error({ code: "SignatureDoesNotMatch", status: 403 }))).toBe(false)
	})

	test("leaves a missing object alone", () => {
		expect(isTransientS3Error(s3Error({ code: "NoSuchKey", status: 404 }))).toBe(false)
	})

	test("does not mistake a network failure for a bucket fault", () => {
		expect(isTransientS3Error(new TypeError("fetch failed"))).toBe(false)
		expect(isTransientS3Error("boom")).toBe(false)
		expect(isTransientS3Error(null)).toBe(false)
	})
})
