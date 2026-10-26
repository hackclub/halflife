import { readAudit, readProjects, readSubmission, readSubmissionReviews, seedSubmission } from "./db"
import { expect, test } from "./fixtures"

test("a reviewer can claim and reject a design submission", async ({ openAs }) => {
	const submission = await seedSubmission()
	const { page, user } = await openAs({ role: "REVIEWER" })

	await page.goto("/review")
	await expect(page.getByRole("heading", { level: 1, name: "Review queue" })).toBeVisible()

	const row = page.getByRole("row").filter({ hasText: submission.projectTitle })
	await expect(row).toBeVisible()
	await row.getByRole("link", { name: "Open" }).click()

	await expect(page.getByRole("button", { name: "Claim" })).toBeVisible()
	const claimed = page.waitForResponse(
		response =>
			response.url().endsWith(`/api/review/submissions/${submission.submissionId}/claim`)
			&& response.request().method() === "POST",
	)
	await page.getByRole("button", { name: "Claim" }).click()
	expect((await claimed).status()).toBe(200)

	await page.reload()
	await expect(page.getByRole("button", { name: "Release" })).toBeVisible()

	const decided = page.waitForResponse(
		response =>
			response.url().endsWith(`/api/review/submissions/${submission.submissionId}/decision`)
			&& response.request().method() === "POST",
	)
	await page.getByLabel("Decision").selectOption("REJECTED")
	await page.getByLabel("Feedback to the participant").fill("The schematic needs a clearer power section.")
	await page.getByLabel("Internal note").fill("Rejected by the browser test suite.")
	await page.getByRole("button", { name: "Record decision" }).click()
	expect((await decided).status()).toBe(200)

	await expect(page).toHaveURL(/\/review$/)
	await expect(page.getByRole("heading", { level: 1, name: "Review queue" })).toBeVisible()
	await expect(page.getByRole("row").filter({ hasText: submission.projectTitle })).toHaveCount(0)

	const resolved = await readSubmission(submission.submissionId)
	expect(resolved?.resolvedAt).not.toBeNull()
	expect(resolved?.resolvedResult).toBe("REJECTED")

	const [project] = await readProjects(submission.user.id)
	expect(project?.designStatus).toBe("rejected")

	const [review] = await readSubmissionReviews(submission.submissionId)
	expect(review?.result).toBe("REJECTED")
	expect(review?.feedback).toContain("clearer power section")

	const audit = await readAudit("REVIEW_REJECT")
	expect(audit?.actorEmail).toBe(user.email)
})
