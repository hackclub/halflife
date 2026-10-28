import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * The promotion strip is a CSS module that both root layouts mount, so it cannot rely on either stylesheet's variables being present. Each colour is therefore written as `var(--token, #fallback)`, and the fallbacks are what the platform actually sees.
 *
 * That makes the literal a second copy of the brand, kept in step by hand. This asserts the copies still agree; when a palette value moves, the failure names the fallback to change rather than letting the promo drift quietly.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

function theme(css: string): { [_: string]: string } {
	const start = css.indexOf("@theme")
	const open = css.indexOf("{", start)
	const end = css.indexOf("\n}", open)
	const out: { [_: string]: string } = {}
	for (const m of css.slice(open + 1, end).matchAll(/(--color-[a-z0-9-]+)\s*:\s*(#[0-9a-f]{6});/g)) {
		if (m[1] && m[2]) out[m[1]] = m[2]
	}
	return out
}

const promo = read("./sticker-sheet-banner.module.css")
const site = theme(read("../../app/(site)/globals.css"))
const platform = theme(read("../../app/(platform)/globals.css"))

function fallback(name: string): { token: string; value: string } {
	const match = new RegExp(`${name}\\s*:\\s*var\\((--color-[a-z0-9-]+),\\s*(#[0-9a-f]{6})\\);`).exec(promo)
	if (!match?.[1] || !match[2]) throw new Error(`no ${name} fallback`)
	return { token: match[1], value: match[2] }
}

const CASES: [string, { [_: string]: string }][] = [
	["--ink", site],
	["--paper", site],
	["--cyan", site],
	["--line", platform],
	["--navy", platform],
	["--sky", platform],
	["--sky-deep", platform],
	["--violet", platform],
]

describe("promotion strip tokens", () => {
	test.each(CASES)("%s falls back to the value its token holds", (name, palette) => {
		const { token, value } = fallback(name)
		expect(palette[token]).toBe(value)
	})
})
