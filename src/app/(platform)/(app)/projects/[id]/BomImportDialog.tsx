"use client"

import { useEffect, useState } from "react"
import { Modal, ModalTitle } from "@/components/platform/modals/Modal"
import { Button } from "@/components/platform/ui"
import type { BomLine } from "@/lib/bom-schema"
import { formatUsd } from "@/lib/money"
import { BomPayloadSchema, type ImportPreview, ImportPreviewSchema } from "./bom-editor-model"

/**
 * The repo import: one read, a preview, and one confirm.
 *
 * Kept apart from the line form because it is not a field-by-field edit. The read starts when the dialog opens, so the preview is ready by the time it shows.
 */
export function BomImportDialog({
	onClose,
	onImported,
	open,
	projectId,
}: {
	onClose(): void
	onImported(items: BomLine[]): void
	open: boolean
	projectId: string
}) {
	const [loading, setLoading] = useState(false)
	const [importing, setImporting] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [preview, setPreview] = useState<ImportPreview | null>(null)

	useEffect(() => {
		if (!open) return
		let live = true
		setPreview(null)
		setError(null)
		setLoading(true)
		void (async () => {
			try {
				const res = await fetch(`/api/projects/${projectId}/bom/import`, {
					body: JSON.stringify({ apply: false }),
					headers: { "content-type": "application/json" },
					method: "POST",
				})
				const raw: unknown = await res.json().catch(() => null)
				const parsed = BomPayloadSchema.safeParse(raw)
				if (!res.ok) {
					if (live)
						setError((parsed.success ? parsed.data.error?.message : undefined) ?? "Could not read the repo. Try again.")
					return
				}
				const parsedPreview = ImportPreviewSchema.safeParse(raw)
				if (!parsedPreview.success) {
					if (live) setError("The server's answer was not in the expected shape. Try again.")
					return
				}
				if (live) setPreview(parsedPreview.data)
			} catch {
				if (live) setError("Could not reach the server. Try again.")
			} finally {
				if (live) setLoading(false)
			}
		})()
		return () => {
			live = false
		}
	}, [open, projectId])

	async function applyImport(replace: boolean) {
		setImporting(true)
		setError(null)
		try {
			const res = await fetch(`/api/projects/${projectId}/bom/import`, {
				body: JSON.stringify({ apply: true, replace }),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
			const raw: unknown = await res.json().catch(() => null)
			const parsed = BomPayloadSchema.safeParse(raw)
			if (!res.ok) {
				setError((parsed.success ? parsed.data.error?.message : undefined) ?? "That did not save. Try again.")
				return
			}
			if (!parsed.success) {
				setError("The server's answer was not in the expected shape. Try again.")
				return
			}
			onImported(parsed.data.items ?? [])
			onClose()
		} catch {
			setError("Could not reach the server. Try again.")
		} finally {
			setImporting(false)
		}
	}

	return (
		<Modal
			dismissible={!importing}
			footer={
				preview && preview.lines.length > 0 ? (
					<>
						<Button disabled={importing} onClick={onClose} size="sm" variant="ghost">
							Cancel
						</Button>
						{preview.existing > 0 && (
							<Button disabled={importing} onClick={() => applyImport(false)} size="sm" variant="outline">
								{importing ? "Adding…" : `Add ${preview.lines.length} to my list`}
							</Button>
						)}
						<Button disabled={importing} onClick={() => applyImport(true)} size="sm" variant="solid">
							{importing
								? "Importing…"
								: preview.existing > 0
									? `Replace with ${preview.lines.length}`
									: `Import ${preview.lines.length} ${preview.lines.length === 1 ? "part" : "parts"}`}
						</Button>
					</>
				) : (
					<Button disabled={importing} onClick={onClose} size="sm" variant="ghost">
						Close
					</Button>
				)
			}
			onClose={onClose}
			open={open}
			size="lg"
		>
			<ModalTitle sub="Read from the bom*.csv in your project's repo, so parts you have listed once are not typed in again.">
				Import parts from your repo
			</ModalTitle>

			{loading ? (
				<p aria-live="polite" className="hand text-[0.9rem] text-navy-soft">
					reading your repo…
				</p>
			) : error ? (
				<p className="text-[0.88rem] font-semibold text-coral-deep" role="alert">
					{error}
				</p>
			) : preview ? (
				<div className="grid gap-4">
					{preview.lines.length === 0 ? (
						<p className="text-[0.9rem] leading-relaxed text-navy-soft">
							No importable parts were found in <code className="hand text-navy">{preview.path}</code>.
						</p>
					) : (
						<>
							<p className="text-[0.9rem] leading-relaxed text-navy-soft">
								Read {preview.lines.length} {preview.lines.length === 1 ? "part" : "parts"} from{" "}
								<code className="hand text-navy">{preview.path}</code>. What the file did not say is left blank, so open
								each line and add a purpose, and a vendor and price a reviewer can check.
							</p>
							{preview.existing > 0 && (
								<p className="hand text-[0.84rem] text-navy-soft">
									your list already has {preview.existing}. Adding keeps them; replacing clears them first.
								</p>
							)}
							<div className="-mx-1 max-h-[42vh] overflow-auto px-1">
								<table className="w-full min-w-110 text-left text-[0.85rem]">
									<thead>
										<tr className="border-b border-dashed border-line">
											{["Part", "Qty", "Unit", "Vendor"].map(h => (
												<th className="label px-3 py-2 text-navy-soft first:pl-0" key={h} scope="col">
													{h}
												</th>
											))}
										</tr>
									</thead>
									<tbody>
										{preview.lines.map((l, i) => (
											<tr className="border-b border-dashed border-line/60 align-top" key={`${l.name}-${i}`}>
												<td className="py-2 pr-3">
													<span className="block font-semibold [overflow-wrap:anywhere] text-navy">{l.name}</span>
												</td>
												<td className="px-3 py-2 tabular-nums">{l.quantity}</td>
												<td className="px-3 py-2 tabular-nums">
													{l.unitCostUsd > 0 ? (
														formatUsd(l.unitCostUsd)
													) : (
														<span className="text-coral-deep">no price</span>
													)}
												</td>
												<td className="hand px-3 py-2 text-navy-soft">{l.vendor || "-"}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</>
					)}

					{preview.skipped.length > 0 && (
						<div className="rounded-xl bg-black/[.03] px-3.5 py-3">
							<p className="label text-violet-deep">Skipped {preview.skipped.length}</p>
							<ul className="mt-1.5 grid gap-1">
								{preview.skipped.map(s => (
									<li className="text-[0.82rem] leading-snug text-navy-soft" key={s.row}>
										<span className="font-semibold text-navy">{s.name || `line ${s.row}`}</span>: {s.reason}
									</li>
								))}
							</ul>
						</div>
					)}
				</div>
			) : null}
		</Modal>
	)
}
