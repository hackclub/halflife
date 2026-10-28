import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * The console palette aliases the platform's shared hues rather than copying them.
 *
 * The alias has to be a `var()` reference, because a copied hex is a second place to change when the brand moves. This test also pins the handful of values that are deliberately the console's own, so a missing or pasted-over alias fails here rather than in one admin screen.
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

/** Console token → the platform token it aliases. */
const ALIASES: [string, string][] = [
	["--color-surface", "--color-cream"],
	["--color-surface-raised", "--color-paper"],
	["--color-ink-strong", "--color-navy"],
	["--color-accent", "--color-sky"],
	["--color-accent-ink", "--color-navy"],
	["--color-field-edge", "--color-field"],
	["--color-teal-soft", "--color-teal-mid"],
	["--color-coin", "--color-orange"],
	["--color-flame", "--color-coral"],
	["--color-danger", "--color-coral"],
	["--color-success-ink", "--color-teal-ink"],
	["--color-warning-ink", "--color-orange-ink"],
	["--color-danger-ink", "--color-coral-deep"],
]

/** Shared hues the console takes by inheritance, with no declaration of its own. */
const INHERITED = ["--color-teal", "--color-mint", "--color-magenta"]

/** The only colours the console writes as hex; everything else is either an alias or inherited. */
const CONSOLE_ONLY = [
	"--color-ink",
	"--color-ink-muted",
	"--color-surface-sunken",
	"--color-border",
	"--color-accent-bright",
]

describe("console palette", () => {
	test.each(ALIASES)("%s aliases %s", (consoleName, platformName) => {
		expect(platform[platformName]).toBeDefined()
		expect(consoleColors[consoleName]).toBe(`var(${platformName})`)
	})

	test.each(INHERITED)("%s is inherited, not redeclared", name => {
		expect(platform[name]).toBeDefined()
		expect(consoleColors[name]).toBeUndefined()
	})

	test("the internal decorative line reuses the console border", () => {
		expect(consoleColors["--color-line-soft"]).toBe("var(--color-border)")
	})

	test("type is inherited from the platform, not declared again", () => {
		const css = read("../../(platform)/ops.css")
		const consoleBlock = block(css, ".ops-root")
		expect(consoleBlock).not.toContain("--font-sans:")
		expect(consoleBlock).not.toContain("--font-mono:")
		expect(consoleBlock).toContain("font-family: var(--font-display)")
	})

	test("only the console's own colours are written as hex", () => {
		const literals = Object.entries(consoleColors)
			.filter(([, value]) => /^#[0-9a-f]{6}$/i.test(value))
			.map(([name]) => name)
			.toSorted()
		expect(literals).toEqual(CONSOLE_ONLY.toSorted())
	})

	// The one name with a value of its own; a copy that silently became the platform's would make console and trail body text identical.
	test("ink is the console's own colour", () => {
		expect(consoleColors["--color-ink"]).toBe("#100f30")
		expect(platform["--color-ink"]).toBe("#262a2d")
	})
})
