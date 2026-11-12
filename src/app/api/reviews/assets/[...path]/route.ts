import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ path: string[] }>
}

/**
 * The review file viewer's runtime assets – WebAssembly, pdf.js's worker and its font and cmap data – served from the installed packages.
 *
 * Fabricate's viewer reached these through Vite's `?url` and `import.meta.glob`, which Next has no equivalent for. The image ships the full production `node_modules` (see the runner stage of the Dockerfile), so they are read from there, and the version served is always the version installed.
 *
 * An allowlist, not a path: each entry names one file or one directory and the extensions allowed in it, and a name is a single plain segment, so nothing outside these packages can be read. No session check, because every file here is a public npm artifact – the routes that read anyone's data are `/api/reviews/[id]/files/*`.
 */
const FILES: { [_: string]: { file: string; type: string } } = Object.freeze({
	"libarchive.wasm": { file: "libarchive-wasm/dist/libarchive.wasm", type: "application/wasm" },
	"occt-import-js.wasm": { file: "occt-import-js/dist/occt-import-js.wasm", type: "application/wasm" },
	"pdfjs/pdf.worker.min.mjs": { file: "pdfjs-dist/build/pdf.worker.min.mjs", type: "text/javascript; charset=utf-8" },
})

const DIRECTORIES: { [_: string]: { dir: string; types: { [ext: string]: string } } } = Object.freeze({
	"pdfjs/cmaps": { dir: "pdfjs-dist/cmaps", types: { bcmap: "application/octet-stream" } },
	"pdfjs/standard_fonts": {
		dir: "pdfjs-dist/standard_fonts",
		types: { pfb: "application/octet-stream", ttf: "font/ttf" },
	},
	"pdfjs/wasm": { dir: "pdfjs-dist/wasm", types: { wasm: "application/wasm" } },
})

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function resolveAsset(segments: string[]): { file: string; type: string } | null {
	const exact = FILES[segments.join("/")]
	if (exact) return exact
	const name = segments.at(-1)
	const directory = DIRECTORIES[segments.slice(0, -1).join("/")]
	if (!name || !directory || !NAME.test(name) || name.includes("..")) return null
	const type = directory.types[name.split(".").pop() ?? ""]
	return type ? { file: `${directory.dir}/${name}`, type } : null
}

export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
	const asset = resolveAsset((await params).path)
	if (!asset) return new NextResponse(null, { status: 404 })
	let body: Buffer
	try {
		body = await readFile(join(process.cwd(), "node_modules", asset.file))
	} catch {
		return new NextResponse(null, { status: 404 })
	}
	return new NextResponse(new Uint8Array(body), {
		headers: {
			"Cache-Control": "public, max-age=86400",
			"Content-Length": String(body.byteLength),
			"Content-Type": asset.type,
		},
	})
}
