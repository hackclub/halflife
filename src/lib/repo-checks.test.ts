import { describe, expect, test } from "bun:test"
import { readmeImageCount, readmeSchematicImage } from "@/lib/repo-checks"

describe("readmeSchematicImage", () => {
	test("finds a schematic named in the alt text", () => {
		expect(readmeSchematicImage("![Schematic of the board](assets/board.png)")).toBe(true)
	})

	test("finds a schematic named in the path", () => {
		expect(readmeSchematicImage("![The board](assets/schematic-v2.png)")).toBe(true)
	})

	test("finds the usual short file name", () => {
		expect(readmeSchematicImage("![Board](assets/sch.png)")).toBe(true)
	})

	test("follows a reference-style image to its definition", () => {
		const readme = ["![The board][board]", "", "[board]: assets/schematic.png"].join("\n")
		expect(readmeSchematicImage(readme)).toBe(true)
	})

	test("does not take a board photo for a schematic", () => {
		expect(readmeSchematicImage("![Finished board](assets/board.jpg)")).toBe(false)
	})

	test("is false when the README has no images", () => {
		expect(readmeSchematicImage("A keypad with a schematic in the repo.")).toBe(false)
	})
})

describe("readmeImageCount", () => {
	test("counts a Markdown image on one line", () => {
		expect(readmeImageCount("![Board](assets/board.png)")).toBe(1)
	})

	test("counts an image whose closing bracket is on the next line", () => {
		const readme = ["![Finished build](assets/full_build.jpeg", ")", "", "![Schematic](assets/schematic.png", ")"].join(
			"\n",
		)
		expect(readmeImageCount(readme)).toBe(2)
	})

	test("counts an image whose path starts on the next line", () => {
		expect(readmeImageCount("![Board](\nassets/board.png)")).toBe(1)
	})

	test("counts an image with a title", () => {
		expect(readmeImageCount('![Board](assets/board.png "The finished board")')).toBe(1)
	})

	test("counts an HTML image spread over several lines", () => {
		const readme = ["<img", '  src="assets/board.png"', '  alt="The finished board"', "/>"].join("\n")
		expect(readmeImageCount(readme)).toBe(1)
	})

	test("counts reference-style images", () => {
		const readme = ["![Board][board]", "", "[board]: assets/board.png"].join("\n")
		expect(readmeImageCount(readme)).toBe(1)
	})

	test("does not count a plain link", () => {
		expect(readmeImageCount("[The board](assets/board.png)")).toBe(0)
	})

	test("does not count prose without images", () => {
		expect(readmeImageCount("A macropad with six keys and an OLED display.")).toBe(0)
	})
})
