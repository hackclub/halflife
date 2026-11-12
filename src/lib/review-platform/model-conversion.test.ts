import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { conversionAvailable, isConvertible, ModelConversion } from "@/lib/review-platform/model-conversion"

/**
 * The conversion pipeline end to end, with a stand-in for FART, so it runs without OpenCascade or a network.
 *
 * The stand-in answers according to the file asked for: converted at once, still working, failed with a reason, a refused token, or a result that has gone by the time it is downloaded.
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
const SHA = "a".repeat(40)
const requests: { authorization: string | null; method: string; url: string }[] = []
const calls = new Map<string, number>()

const json = (body: unknown, status = 200): Response => Response.json(body, { status })

function fart(url: URL, method: string, authorization: string | null): Response {
	if (authorization !== "Bearer test-token")
		return json({ error: "FART does not recognise the token this app sent." }, 401)
	const path = url.searchParams.get("path") ?? ""
	const action = url.pathname.split("/").at(-1)
	const key = `${action}:${path}`
	const count = (calls.get(key) ?? 0) + 1
	calls.set(key, count)
	if (action === "converted") {
		if (path.startsWith("gone") && count === 1) return json({ error: "This model hasn't been converted yet." }, 404)
		return new Response(`glTF for ${path}`, { headers: { "Content-Type": "model/gltf-binary" } })
	}
	if (method !== "POST") return json({ error: "Method not allowed." }, 405)
	if (path.startsWith("bad")) return json({ error: "OpenCascade could not read this file.", state: "failed" })
	if (path.startsWith("slow") && count === 1) return json({ message: "Meshing solids on the server", state: "working" })
	return json({ state: "done" })
}

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "model-conversion-test-"))
	process.env.FART_URL = "https://fart.test/"
	process.env.FART_TOKEN = "test-token"
	process.env.MODEL_CONVERSION_DIR = join(dir, "results")
	realFetch = globalThis.fetch
	globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
		const authorization = new Headers(init?.headers).get("authorization")
		const method = init?.method ?? "GET"
		requests.push({ authorization, method, url: url.href })
		return Promise.resolve(fart(url, method, authorization))
	}
	mod = await import("@/lib/review-platform/model-conversion")
})

afterAll(async () => {
	globalThis.fetch = realFetch
	await rm(dir, { force: true, recursive: true })
})

async function convert(path: string): Promise<{
	conversion: InstanceType<Module["ModelConversion"]>
	status: Awaited<ReturnType<InstanceType<Module["ModelConversion"]>["status"]>>
}> {
	const conversion = new mod.ModelConversion("maker/robot", SHA, path)
	await conversion.start()
	for (let i = 0; i < 300; i++) {
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
	test("asks FART, keeps the result, and serves it again without asking twice", async () => {
		expect(mod.conversionAvailable()).toBe(true)
		const { conversion, status } = await convert("CAD/arm step.step")
		expect(status?.state).toBe("done")
		const result = await readFile(join(dir, "results", `${conversion.key}.glb`), "utf8")
		expect(result).toBe("glTF for CAD/arm step.step")
		const opened = await conversion.open()
		expect(opened?.size).toBe(status?.size)
		opened?.stream.destroy()

		const asked = requests.filter(request => request.url.includes("arm%20step") || request.url.includes("arm+step"))
		expect(asked.map(request => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
			"POST /api/repos/maker/robot/convert",
			"GET /api/repos/maker/robot/converted",
		])
		expect(asked.map(request => new URL(request.url).searchParams.get("sha"))).toEqual([SHA, SHA])
		expect(asked.every(request => request.authorization === "Bearer test-token")).toBe(true)

		// Done is read off disk, so a second ask answers at once and asks FART nothing.
		const before = requests.length
		expect((await conversion.start()).state).toBe("done")
		expect(requests.length).toBe(before)
	})

	test("waits while FART works on it, passing its progress on", async () => {
		const conversion = new mod.ModelConversion("maker/robot", SHA, "slow.step")
		await conversion.start()
		await Bun.sleep(100)
		expect(await conversion.status()).toEqual({ message: "Meshing solids on the server", state: "working" })
		const { status } = await convert("slow.step")
		expect(status?.state).toBe("done")
	}, 10_000)

	test("reports FART's own reason when it fails", async () => {
		const { status } = await convert("bad.step")
		expect(status).toEqual({ error: "OpenCascade could not read this file.", state: "failed" })
	})

	test("asks again when the result is gone before it is downloaded", async () => {
		const { status } = await convert("gone.step")
		expect(status?.state).toBe("done")
	}, 10_000)

	test("says so when FART refuses the token", async () => {
		process.env.FART_TOKEN = "wrong"
		try {
			const { status } = await convert("refused.step")
			expect(status).toEqual({ error: "FART does not recognise the token this app sent.", state: "failed" })
		} finally {
			process.env.FART_TOKEN = "test-token"
		}
	})

	test("is not available without FART configured", () => {
		process.env.FART_URL = ""
		try {
			expect(mod.conversionAvailable()).toBe(false)
		} finally {
			process.env.FART_URL = "https://fart.test/"
		}
	})
})
