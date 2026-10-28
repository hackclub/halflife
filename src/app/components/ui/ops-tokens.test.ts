import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * The console palette is a copy of the platform's, not an import of it.
 *
 * That is deliberate: the console is the earlier system, and it has to stand on its own rather than resolve its colours through a stylesheet it does not own. The copy has stayed exact for every shared hue, with one intended exception — the console's body ink is `#100f30`, not the platform's `#262a2d` — and this test is what keeps the next brand edit from changing one and forgetting the other.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

function block(css: string, opener: string): string {
	const start = css.indexOf(opener)
	if (start === -1) throw new Error(`no ${opener}`)
	const open = css.indexOf("{", start)
	const end = css.indexOf("\n}", open)
	return css.slice(open + 1, end)
}

function colors(css: string, opener: string): { [_: string]: string } {
	const out: { [_: string]: string } = {}
	for (const match of block(css, opener).matchAll(/(--color-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
		const [name, value] = [match[1], match[2]]
		if (name && value) out[name] = value.trim()
	}
	return out
}

const platform = colors(read("../../(platform)/globals.css"), "@theme")
const consoleColors = colors(read("../../(platform)/ops.css"), ".ops-root")

/** Platform name → console name, for every value the two palettes share. */
const SHARED: [string, string][] = [
	["--color-cream", "--color-surface"],
	["--color-paper", "--color-surface-raised"],
	["--color-navy", "--color-ink-strong"],
	["--color-navy", "--color-accent-ink"],
	["--color-sky", "--color-accent"],
	["--color-teal", "--color-teal"],
	["--color-teal-mid", "--color-teal-soft"],
	["--color-mint", "--color-mint"],
	["--color-magenta", "--color-magenta"],
	["--color-coral", "--color-flame"],
	["--color-coral", "--color-danger"],
	["--color-coral-deep", "--color-danger-ink"],
	["--color-orange", "--color-coin"],
	["--color-teal-ink", "--color-success-ink"],
	["--color-orange-ink", "--color-warning-ink"],
	["--color-field", "--color-field-edge"],
]

describe("console palette", () => {
	test.each(SHARED)("%s and %s hold the same value", (platformName, consoleName) => {
		expect(platform[platformName]).toBeDefined()
		expect(consoleColors[consoleName]).toBeDefined()
		expect(consoleColors[consoleName]).toBe(platform[platformName])
	})

	// The one name with a value of its own; a copy that silently became the platform's would make console and trail body text identical.
	test("ink is the console's own colour", () => {
		expect(consoleColors["--color-ink"]).toBe("#100f30")
		expect(platform["--color-ink"]).toBe("#262a2d")
	})

	// Two names for the same edge inside the console itself; a resident of one world, not a cross-world pair.
	test("the console's border names agree", () => {
		expect(consoleColors["--color-line-soft"]).toBe(consoleColors["--color-border"])
	})
})
