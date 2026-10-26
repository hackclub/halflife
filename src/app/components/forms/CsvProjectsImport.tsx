"use client"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { z } from "zod"
import { Button, Callout } from "@/app/components/ui"

const CsvOutcomeSchema = z.object({
	email: z.string(),
	projectId: z.string(),
	reason: z.string().nullable(),
	status: z.enum(["imported", "already_imported", "failed"]),
	title: z.string(),
})
type CsvOutcome = z.infer<typeof CsvOutcomeSchema>

const CsvImportResponseSchema = z.object({
	alreadyImported: z.number().optional(),
	error: z
		.object({
			details: z
				.object({ problems: z.array(z.object({ line: z.number(), message: z.string() })).optional() })
				.optional(),
			message: z.string().optional(),
		})
		.optional(),
	failed: z.number().optional(),
	imported: z.number().optional(),
	outcomes: z.array(CsvOutcomeSchema).optional(),
	read: z.number().optional(),
})

interface CsvSummary {
	alreadyImported: number
	failed: number
	imported: number
	outcomes: CsvOutcome[]
	read: number
}

/**
 * Projects from a Macondo CSV export, in one upload.
 *
 * Like the Airtable importer it says what each row became and what it could not, so a half-failed file is visible rather than swallowed – and it is safe to re-run, since rows filed already are reported instead of duplicated.
 */
export function CsvProjectsImport() {
	const router = useRouter()
	const picker = useRef<HTMLInputElement>(null)
	const [file, setFile] = useState<File | null>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [problems, setProblems] = useState<{ line: number; message: string }[]>([])
	const [summary, setSummary] = useState<CsvSummary | null>(null)

	async function run() {
		if (!file) return
		if (
			!window.confirm(
				`Import ${file.name} as warm-up projects? This creates an account for any email that has none, one Theme.WARMUP project per row, and a devlog per entry in the row's journals column.`,
			)
		)
			return

		setBusy(true)
		setError(null)
		setProblems([])
		setSummary(null)
		try {
			const res = await fetch("/api/admin/program/import-projects-csv", {
				body: JSON.stringify({ csv: await file.text() }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			})
			const parsed = CsvImportResponseSchema.safeParse(await res.json().catch(() => null))
			if (!res.ok) {
				setError((parsed.success ? parsed.data.error?.message : undefined) ?? `Import failed (${res.status})`)
				setProblems((parsed.success ? parsed.data.error?.details?.problems : undefined) ?? [])
				return
			}
			if (!parsed.success) {
				setError("The server's answer was not in the expected shape")
				return
			}
			setSummary({
				alreadyImported: parsed.data.alreadyImported ?? 0,
				failed: parsed.data.failed ?? 0,
				imported: parsed.data.imported ?? 0,
				outcomes: parsed.data.outcomes ?? [],
				read: parsed.data.read ?? 0,
			})
			setFile(null)
			router.refresh()
		} catch {
			setError("Could not reach the server")
		} finally {
			setBusy(false)
		}
	}

	const failures = summary?.outcomes.filter(o => o.status === "failed") ?? []

	return (
		<div className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}

			{problems.length > 0 ? (
				<Callout>
					<ul className="hl-stack hl-stack--tight" style={{ marginTop: "0.5rem", paddingLeft: "1rem" }}>
						{problems.map(p => (
							<li className="hl-hint" key={`${p.line}-${p.message}`}>
								Line {p.line}: {p.message}
							</li>
						))}
					</ul>
				</Callout>
			) : null}

			{summary ? (
				<Callout>
					<p>
						Read {summary.read} rows: {summary.imported} imported, {summary.alreadyImported} already imported,{" "}
						{summary.failed} failed.
					</p>
					{failures.length > 0 ? (
						<ul className="hl-stack hl-stack--tight" style={{ marginTop: "0.5rem", paddingLeft: "1rem" }}>
							{failures.map(o => (
								<li className="hl-hint" key={o.projectId}>
									<span className="hl-mono">{o.projectId}</span> · {o.email} · failed
									{o.reason ? `: ${o.reason}` : ""}
								</li>
							))}
						</ul>
					) : null}
				</Callout>
			) : null}

			<div className="hl-stack hl-stack--tight">
				<input
					accept=".csv,text/csv,text/plain"
					className="block text-[0.85rem]"
					onChange={e => {
						setFile(e.target.files?.[0] ?? null)
						setSummary(null)
						setError(null)
						setProblems([])
					}}
					ref={picker}
					type="file"
				/>
				<Button disabled={busy || !file} onClick={() => run()} variant="primary">
					{busy ? "Importing… (this can take a while)" : "Import projects from CSV"}
				</Button>
			</div>
		</div>
	)
}
