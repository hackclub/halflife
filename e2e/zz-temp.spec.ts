import { readAudit } from "./db"
import { expect, test } from "./fixtures"

test("temp", async ({ admin }) => {
	expect(admin).toBeTruthy()
	const audit = await readAudit("ADMIN_BAN_USER")
	expect(audit).toBeNull()
})
