"use client"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { z } from "zod"
import { Button, Callout } from "@/app/components/ui"
import { SHOP_CSV_COLUMNS, SHOP_CSV_MAX_ROWS, SHOP_CSV_TEMPLATE, type ShopCsvProblem } from "@/lib/shop-csv"

/**
 * Add many shop items from a spreadsheet export.
 *
 * All or nothing, like the route behind it: a refused file lists every line to fix, so staff correct the sheet and import it again rather than working out which half of it made it in.
 */
const ShopCsvProblemSchema = z.object({ line: z.number(), message: z.string() })

const ShopImportResponseSchema = z.object({
	created: z.number().optional(),
	error: z
		.object({
			details: z.object({ problems: z.array(ShopCsvProblemSchema).optional() }).optional(),
			message: z.string().optional(),
		})
		.optional(),
})

export function ShopItemImport() {
	const router = useRouter()
	const picker = useRef<HTMLInputElement>(null)
	const [file, setFile] = useState<File | null>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [problems, setProblems] = useState<ShopCsvProblem[]>([])
	const [created, setCreated] = useState<number | null>(null)

	async function run() {
		if (!file) return
		setBusy(true)
		setError(null)
		setProblems([])
		setCreated(null)
		try {
			const res = await fetch("/api/admin/shop/items/import", {
				body: JSON.stringify({ csv: await file.text() }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			})
			const parsed = ShopImportResponseSchema.safeParse(await res.json().catch(() => null))
			if (!res.ok) {
				setError((parsed.success ? parsed.data.error?.message : undefined) ?? `Import failed (${res.status})`)
				setProblems((parsed.success ? parsed.data.error?.details?.problems : undefined) ?? [])
				return
			}
			if (!parsed.success) {
				setError("The server's answer was not in the expected shape")
				return
			}
			setCreated(parsed.data.created ?? 0)
			setFile(null)
			router.refresh()
		} catch {
			setError("Could not reach the server")
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="hl-stack hl-stack--tight">
			<p className="hl-hint">
				Columns: <span className="hl-mono">{SHOP_CSV_COLUMNS.join(", ")}</span>. Slug, name, description and price are
				required. Category is upgrade, consumable or misc (upgrade if blank); cost is in USD; gated is yes or no (yes if
				blank). Up to {SHOP_CSV_MAX_ROWS} items, and new slugs only.{" "}
				<a download="shop-items.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(SHOP_CSV_TEMPLATE)}`}>
					Download a template
				</a>
				.
			</p>

			{error ? (
				<Callout tone="danger">
					{error}
					{problems.length > 0 ? (
						<ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
							{problems.map((p, i) => (
								// Two problems can share a line; the list is replaced whole, never reordered.
								<li key={`${p.line}-${i}`}>
									{p.line > 0 ? `Line ${p.line}: ` : ""}
									{p.message}
								</li>
							))}
						</ul>
					) : null}
				</Callout>
			) : null}
			{created !== null ? (
				<Callout>
					Added {created} {created === 1 ? "item" : "items"}.
				</Callout>
			) : null}

			<div className="hl-row" style={{ alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
				<Button disabled={busy} onClick={() => picker.current?.click()} type="button">
					{file ? "Choose another file" : "Choose a CSV"}
				</Button>
				{file ? <span className="hl-mono">{file.name}</span> : null}
				<input
					accept=".csv,text/csv"
					hidden
					onChange={e => {
						setFile(e.target.files?.[0] ?? null)
						setError(null)
						setProblems([])
						setCreated(null)
						e.target.value = ""
					}}
					ref={picker}
					type="file"
				/>
				<Button disabled={!file || busy} onClick={() => run()} type="button" variant="primary">
					{busy ? "Importing…" : "Import items"}
				</Button>
			</div>
		</div>
	)
}
