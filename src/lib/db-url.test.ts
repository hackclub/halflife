import { describe, expect, test } from "bun:test"
import { bunSqlUrl } from "@/lib/db-url"

describe("bunSqlUrl", () => {
	test("drops the Prisma schema parameter Bun would send as a startup parameter", () => {
		expect(bunSqlUrl("postgresql://postgres:pw@localhost:5432/halflife?schema=public")).toBe(
			"postgresql://postgres:pw@localhost:5432/halflife",
		)
	})

	test("keeps the parameters Bun understands", () => {
		expect(bunSqlUrl("postgresql://db.example.com/halflife?sslmode=require&max=5")).toBe(
			"postgresql://db.example.com/halflife?sslmode=require&max=5",
		)
	})

	test("leaves a URL with no parameters alone", () => {
		expect(bunSqlUrl("postgresql://postgres:pw@127.0.0.1:5432/halflife_e2e")).toBe(
			"postgresql://postgres:pw@127.0.0.1:5432/halflife_e2e",
		)
	})
})
