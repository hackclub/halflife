"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout } from "@/app/components/ui"

type ImportOutcome = {
	recordId: string
	email: string | null
	status: "imported" | "already_imported" | "skipped" | "failed"
	reason: string | null
	themeProjectId: string | null
	ari: "sent" | "failed" | "not_configured" | "not_attempted"
}

type ImportSummary = {
	table: string
	fetched: number
	imported: number
	alreadyImported: number
	skipped: number
	failed: number
	ariSent: number
	outcomes: ImportOutcome[]
}

const STATUS_LABEL: Record<ImportOutcome["status"], string> = {
	imported: "imported",
	already_imported: "already imported",
	skipped: "skipped",
	failed: "failed",
}

const ARI_LABEL: Record<ImportOutcome["ari"], string> = {
	sent: "sent to Ari",
	failed: "Ari send failed",
	not_configured: "Ari not configured",
	not_attempted: "",
}

/**
 * One button that pulls the warm-up form's rows out of Airtable.
 *
 * It reports what each row did rather than only refreshing: a skipped row is usually something a human has to look at (a row with no email, or one Half Life wrote itself), and the whole point of surfacing it is that the import not silently drop a project it was asked to bring across.
 */
export function AirtableImportForm({
	ariConfigured,
}: Readonly<{
	ariConfigured: boolean
}>) {
	const router = useRouter()
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [summary, setSummary] = useState<ImportSummary | null>(null)

	async function run() {
		if (
			!window.confirm(
				"Import warm-up projects from Airtable? This creates an account for any submitter who has none, files each project on the Warm Up track, and sends each one to Ari for review.",
			)
		) {
			return
		}
		setBusy(true)
		setError(null)
		setSummary(null)
		try {
			const res = await fetch("/api/admin/program/import-airtable", { method: "POST" })
			if (!res.ok) {
				const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
				setError(payload.error?.message ?? `Import failed (${res.status})`)
				return
			}
			const payload = (await res.json()) as { summary: ImportSummary }
			setSummary(payload.summary)
			router.refresh()
		} catch {
			setError("Could not reach the server")
		} finally {
			setBusy(false)
		}
	}

	const problems = summary?.outcomes.filter(o => o.status === "skipped" || o.status === "failed") ?? []

	return (
		<div className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}

			{summary ? (
				<Callout>
					<p>
						Read {summary.fetched} rows from <code>{summary.table}</code>: {summary.imported} imported,{" "}
						{summary.alreadyImported} already imported, {summary.skipped} skipped, {summary.failed} failed.{" "}
						{ariConfigured
							? `${summary.ariSent} sent to Ari; the rest are listed under “Submissions that never reached Ari”.`
							: "Ari is not configured here, so those sends wait for the retry job."}
					</p>
					{problems.length > 0 ? (
						<ul className="hl-stack hl-stack--tight" style={{ marginTop: "0.5rem", paddingLeft: "1rem" }}>
							{problems.map(outcome => (
								<li key={outcome.recordId} className="hl-hint">
									<span className="hl-mono">{outcome.recordId}</span>
									{outcome.email ? ` · ${outcome.email}` : ""} · {STATUS_LABEL[outcome.status]}
									{outcome.reason ? ` – ${outcome.reason}` : ""}
									{ARI_LABEL[outcome.ari] ? ` (${ARI_LABEL[outcome.ari]})` : ""}
								</li>
							))}
						</ul>
					) : null}
				</Callout>
			) : null}

			<div>
				<Button variant="primary" disabled={busy} onClick={() => run()}>
					{busy ? "Importing… (this can take a few minutes)" : "Import projects from Airtable"}
				</Button>
			</div>
		</div>
	)
}
