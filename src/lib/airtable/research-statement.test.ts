import { describe, expect, test } from "bun:test"
import { RESEARCH_TIME_STATEMENT, withResearchStatement } from "@/lib/airtable/research-statement"

const url = "https://halflife.hackclub.com/projects/prj_1"

describe("withResearchStatement", () => {
	test("places the statement before an existing project link", () => {
		expect(withResearchStatement(`Solid PCB work.\n\nProject on Half Life: ${url}`)).toBe(
			`Solid PCB work.\n\n${RESEARCH_TIME_STATEMENT}\n\nProject on Half Life: ${url}`,
		)
	})

	test("places the statement before a link that is the whole cell", () => {
		expect(withResearchStatement(`Project on Half Life: ${url}`)).toBe(
			`${RESEARCH_TIME_STATEMENT}\n\nProject on Half Life: ${url}`,
		)
	})

	test("appends the statement after a note with no link", () => {
		expect(withResearchStatement("Solid PCB work.")).toBe(`Solid PCB work.\n\n${RESEARCH_TIME_STATEMENT}`)
	})

	test("writes the statement alone into an empty cell", () => {
		expect(withResearchStatement("")).toBe(RESEARCH_TIME_STATEMENT)
	})

	test("leaves a cell that already has the statement exactly as it is", () => {
		const cell = `Solid PCB work.\n\n${RESEARCH_TIME_STATEMENT}\n\nProject on Half Life: ${url}`
		expect(withResearchStatement(cell)).toBe(cell)
		expect(withResearchStatement(withResearchStatement(cell))).toBe(cell)
	})
})
