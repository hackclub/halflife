import { readAudit, readProgramSettings } from "./db"
import { expect, test } from "./fixtures"

test("an admin can change program settings and see the audit entry", async ({ openAs }) => {
	const { page, user } = await openAs({ role: "ADMIN" })
	await page.goto("/admin/program")

	await expect(page.getByRole("heading", { level: 1, name: "Program settings" })).toBeVisible()

	const submissions = page.getByLabel("Submissions open")
	const next = !(await submissions.isChecked())
	if (next) await submissions.check()
	else await submissions.uncheck()

	await page.getByRole("button", { name: "Save settings" }).click()
	await expect(page.getByText("Saved.", { exact: true })).toBeVisible({ timeout: 15_000 })

	expect((await readProgramSettings())?.submissionsOpen).toBe(next)

	const audit = await readAudit("ADMIN_UPDATE_PROGRAM_SETTINGS")
	expect(audit?.actorEmail).toBe(user.email)

	await page.goto("/admin/audit?action=ADMIN_UPDATE_PROGRAM_SETTINGS")
	await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible()

	const row = page.getByRole("row").filter({ hasText: "ADMIN_UPDATE_PROGRAM_SETTINGS" }).first()
	await expect(row).toBeVisible()
	await expect(row).toContainText(user.email)
})
