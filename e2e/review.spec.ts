import { readAudit, readProjects, readSubmission, readSubmissionReviews, seedSubmission } from "./db"
import { expect, test } from "./fixtures"

test("a reviewer can claim and return a design submission", async ({ openAs }) => {
	const submission = await seedSubmission()
	const { page, user } = await openAs({ role: "REVIEWER" })

	await page.goto(`/reviews/${submission.submissionId}`)
	await expect(page.getByRole("button", { name: "Claim review" })).toBeVisible()
	const claimed = page.waitForResponse(
		response =>
			response.url().endsWith(`/api/review/submissions/${submission.submissionId}/claim`)
			&& response.request().method() === "POST",
	)
	await page.getByRole("button", { name: "Claim review" }).click()
	expect((await claimed).status()).toBe(200)
	await expect(page.getByRole("button", { name: "Return for changes" })).toBeEnabled()

	await page.getByLabel("Message to the maker").fill("The schematic needs a clearer power section.")
	const decided = page.waitForResponse(
		response =>
			response.url().endsWith(`/api/review/submissions/${submission.submissionId}/decision`)
			&& response.request().method() === "POST",
	)
	await page.getByRole("button", { name: "Return for changes" }).click()
	expect((await decided).status()).toBe(200)

	await expect(page).toHaveURL(/\/reviews(\?|$|\/)/)

	const resolved = await readSubmission(submission.submissionId)
	expect(resolved?.resolvedAt).not.toBeNull()
	expect(resolved?.resolvedResult).toBe("RETURNED")

	const [project] = await readProjects(submission.user.id)
	expect(project?.designStatus).toBe("update_requested")

	const [review] = await readSubmissionReviews(submission.submissionId)
	expect(review?.result).toBe("RETURNED")
	expect(review?.feedback).toContain("clearer power section")

	const audit = await readAudit("REVIEW_RETURN")
	expect(audit?.actorEmail).toBe(user.email)
})
