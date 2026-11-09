import { readFile } from "node:fs/promises"
import { readAudit, readGrantExports, readProgramSettings, seedApprovedProject, seedUser } from "./db"
import { expect, test } from "./fixtures"
import { waitForHydration } from "./hydration"

test("an admin can change program settings and see the audit entry", async ({ openAs }) => {
	const { page, user } = await openAs({ role: "ADMIN" })
	await page.goto("/admin/program")

	await expect(page.getByRole("heading", { level: 1, name: "Program settings" })).toBeVisible()

	const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Save settings" }) })
	await waitForHydration(form)

	const submissions = form.getByLabel("Submissions open")
	const next = !(await submissions.isChecked())
	if (next) await submissions.check()
	else await submissions.uncheck()

	const payoutSource = form.getByLabel("Payout source")
	const nextSource = (await readProgramSettings())?.payoutSource === "HCB" ? "AIRTABLE" : "HCB"
	await payoutSource.selectOption(nextSource)

	await form.getByRole("button", { name: "Save settings" }).click()
	await expect(page.getByText("Saved.", { exact: true })).toBeVisible({ timeout: 15_000 })

	const settings = await readProgramSettings()
	expect(settings?.submissionsOpen).toBe(next)
	expect(settings?.payoutSource).toBe(nextSource)

	const audit = await readAudit("ADMIN_UPDATE_PROGRAM_SETTINGS")
	expect(audit?.actorEmail).toBe(user.email)

	await page.goto("/admin/audit?action=ADMIN_UPDATE_PROGRAM_SETTINGS")
	await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible()

	const row = page.getByRole("row").filter({ hasText: "ADMIN_UPDATE_PROGRAM_SETTINGS" }).first()
	await expect(row).toBeVisible()
	await expect(row).toContainText(user.email)
})

test("an admin can generate and re-download an HCB grant CSV", async ({ openAs }) => {
	const { page } = await openAs({ onboarding: "complete", role: "ADMIN" })
	const maker = await seedUser({ onboarding: "complete" })
	const projectId = await seedApprovedProject(maker.id)

	// The export path needs HCB to own payouts; switch the source like an admin would.
	await page.goto("/admin/program")
	const settingsForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Save settings" }) })
	await waitForHydration(settingsForm)
	await settingsForm.getByLabel("Payout source").selectOption("HCB")
	await settingsForm.getByRole("button", { name: "Save settings" }).click()
	await expect(page.getByText("Saved.", { exact: true })).toBeVisible({ timeout: 15_000 })

	await page.goto("/admin/grants")
	// The count is not pinned to one: a retried run leaves its own project behind with the rest.
	const generate = page.getByRole("button", { name: /Generate CSV for \d+ card grants/ })
	await expect(generate).toBeEnabled()
	await generate.click()

	const [download] = await Promise.all([
		page.waitForEvent("download"),
		page.getByRole("button", { name: /^Generate \d+ grants$/ }).click(),
	])
	expect(download.suggestedFilename()).toMatch(/^hcb-card-grants-.+\.csv$/)
	const firstBody = await readFile(await download.path(), "utf-8")
	expect(firstBody).toContain(maker.email)
	expect(firstBody).toContain(`Half Life parts,Parts for E2E payout – http://localhost:3100/projects/${projectId}`)

	// The file was frozen at generation: our row is in the database and the project is out of the next preview.
	const recorded = await readGrantExports()
	const mine = recorded.find(row => row.themeProjectId === projectId)
	expect(mine).toMatchObject({ amountCents: 200, email: maker.email, themeProjectId: projectId })
	expect(mine?.batchId).toBe(download.suggestedFilename().replace("hcb-card-grants-", "").replace(".csv", ""))
	await page.goto("/admin/grants")
	await expect(page.getByText("Already in an HCB CSV import").first()).toBeVisible()

	// The history entry re-downloads the exact file.
	const exportRow = page
		.getByRole("row")
		.filter({ hasText: download.suggestedFilename().replace("hcb-card-grants-", "").replace(".csv", "") })
		.first()
	const [again] = await Promise.all([
		page.waitForEvent("download"),
		exportRow.getByRole("link", { name: "Download CSV" }).click(),
	])
	expect(await readFile(await again.path(), "utf-8")).toBe(firstBody)
})
