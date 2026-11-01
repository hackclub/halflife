import { describe, expect, test } from "bun:test"
import { readmeImageCount } from "@/lib/repo-checks"

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
