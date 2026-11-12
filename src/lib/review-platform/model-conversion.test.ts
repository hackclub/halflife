import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { conversionAvailable, isConvertible, ModelConversion } from "@/lib/review-platform/model-conversion"

/**
 * The conversion pipeline end to end, with a stand-in for `step2glb` and for GitHub, so it runs without OpenCascade or a network.
 *
 * The stand-in is a shell script that behaves according to the file it is handed: it writes the environment it was given into the "GLB" (so the test can see what leaked), fails with a message, or crashes the way the memory cap makes the real one crash.
 */

let dir = ""
let realFetch: typeof fetch
// Imported after the environment is set, because the module reads it on load.
interface Module {
	conversionAvailable: typeof conversionAvailable
	isConvertible: typeof isConvertible
	ModelConversion: typeof ModelConversion
}
let mod: Module
const served = new Map<string, string>()

const CONVERTER = `#!/bin/sh
case "$(cat "$1")" in
	*FAIL*) echo "OpenCascade could not read this file." >&2; exit 3 ;;
	*CRASH*) kill -SEGV $$ ;;
esac
echo "Reading the model"
env > "$2"
`

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "model-conversion-test-"))
	const converter = join(dir, "step2glb")
	await writeFile(converter, CONVERTER)
	await chmod(converter, 0o755)
	process.env.STEP2GLB_PATH = converter
	process.env.MODEL_CONVERSION_DIR = join(dir, "results")
	process.env.REVIEW_TEST_SECRET = "must-not-reach-the-converter"
	realFetch = globalThis.fetch
	globalThis.fetch = (input: string | URL | Request) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		const body = served.get(url)
		return Promise.resolve(body === undefined ? new Response("missing", { status: 404 }) : new Response(body))
	}
	mod = await import("@/lib/review-platform/model-conversion")
})

afterAll(async () => {
	globalThis.fetch = realFetch
	delete process.env.REVIEW_TEST_SECRET
	await rm(dir, { force: true, recursive: true })
})

const raw = (path: string): string => `https://raw.githubusercontent.com/maker/robot/abc1234/${path}`

async function convert(
	path: string,
	body: string,
): Promise<{
	conversion: InstanceType<Module["ModelConversion"]>
	status: Awaited<ReturnType<InstanceType<Module["ModelConversion"]>["status"]>>
}> {
	served.set(raw(path), body)
	const conversion = new mod.ModelConversion("maker/robot", "abc1234", path)
	await conversion.start()
	for (let i = 0; i < 100; i++) {
		const status = await conversion.status()
		if (status?.state === "done" || status?.state === "failed") return { conversion, status }
		await Bun.sleep(20)
	}
	throw new Error("conversion never finished")
}

describe("isConvertible", () => {
	test("is the formats OpenCascade reads, in any case", () => {
		expect(mod.isConvertible("arm.step")).toBe(true)
		expect(mod.isConvertible("CAD/Arm.STP")).toBe(true)
		expect(mod.isConvertible("board.igs")).toBe(true)
		expect(mod.isConvertible("part.brep")).toBe(true)
		expect(mod.isConvertible("arm.f3z")).toBe(false)
		expect(mod.isConvertible("arm.stl")).toBe(false)
		expect(mod.isConvertible("README")).toBe(false)
	})
})

describe("ModelConversion", () => {
	test("converts, keeps the result, and serves it again without converting twice", async () => {
		expect(await mod.conversionAvailable()).toBe(true)
		const { conversion, status } = await convert("CAD/arm.step", "ISO-10303-21;")
		expect(status?.state).toBe("done")
		expect(status?.size).toBeGreaterThan(0)
		const opened = await conversion.open()
		expect(opened?.size).toBe(status?.size)
		opened?.stream.destroy()
		// Done is read off disk, so a second ask answers at once and starts nothing.
		served.delete(raw("CAD/arm.step"))
		expect((await conversion.start()).state).toBe("done")
	})

	test("gives the converter none of the app's environment", async () => {
		const { conversion } = await convert("CAD/env.step", "ISO-10303-21;")
		const result = await readFile(join(dir, "results", `${conversion.key}.glb`), "utf8")
		expect(result).not.toContain("must-not-reach-the-converter")
		expect(result).not.toContain("DATABASE_URL")
		expect(result).toContain("HOME=")
	})

	test("reports the converter's own reason when it fails", async () => {
		const { status } = await convert("CAD/bad.step", "FAIL")
		expect(status).toEqual({ error: "OpenCascade could not read this file.", state: "failed" })
	})

	test("reads a crash as the model being too big", async () => {
		const { status } = await convert("CAD/huge.step", "CRASH")
		expect(status).toEqual({ error: "The model is too big even for the server to convert.", state: "failed" })
	})

	test("follows a Git LFS pointer and checks the object against it", async () => {
		const model = "ISO-10303-21; from LFS"
		const oid = createHash("sha256").update(model).digest("hex")
		const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${model.length}\n`
		served.set("https://media.githubusercontent.com/media/maker/robot/abc1234/CAD/lfs.step", model)
		expect((await convert("CAD/lfs.step", pointer)).status?.state).toBe("done")

		served.set("https://media.githubusercontent.com/media/maker/robot/abc1234/CAD/tampered.step", "something else")
		const tampered = await convert("CAD/tampered.step", pointer)
		expect(tampered.status).toEqual({
			error: "GitHub sent a Git LFS file that does not match its checksum.",
			state: "failed",
		})
	})

	test("says so when GitHub will not hand the file over", async () => {
		const conversion = new mod.ModelConversion("maker/robot", "abc1234", "CAD/gone.step")
		await conversion.start()
		let status = await conversion.status()
		for (let i = 0; i < 100 && status?.state !== "failed"; i++) {
			await Bun.sleep(20)
			status = await conversion.status()
		}
		expect(status).toEqual({ error: "GitHub would not hand over this file (404).", state: "failed" })
	})
})
