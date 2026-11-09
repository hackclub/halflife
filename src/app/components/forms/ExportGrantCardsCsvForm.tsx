"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { z } from "zod"
import { Button, Callout, Modal } from "@/app/components/ui"
import { formatUsd } from "@/lib/money"
import { sendJsonParsed, useAction } from "@/lib/use-action"

const ExportSchema = z.object({
	batchId: z.string(),
	csv: z.string(),
	filename: z.string(),
	totalCents: z.number(),
})

interface ExportProps {
	eligibleCount: number
	fingerprint: string
	payoutSource: string
	totalCents: number
}

/** Hand the browser a file, from the CSV the export froze. */
function downloadCsv(csv: string, filename: string) {
	const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
	const link = document.createElement("a")
	link.download = filename
	link.href = url
	link.click()
	URL.revokeObjectURL(url)
}

export function ExportGrantCardsCsvForm({ initial }: Readonly<{ initial: ExportProps }>) {
	const router = useRouter()
	const { busy, error, run } = useAction()
	const [confirming, setConfirming] = useState(false)
	const [batchId, setBatchId] = useState<string | null>(null)
	const blockedByPayoutSource = initial.payoutSource !== "HCB"
	const blocked = blockedByPayoutSource
		? "Payouts are not set to HCB card grants, so nothing can be exported."
		: initial.eligibleCount === 0
			? "No approved project is ready for a card grant."
			: null

	function generate() {
		setConfirming(false)
		void run("generate", async () => {
			const created = await sendJsonParsed(ExportSchema, "/api/admin/grant-cards/exports", {
				body: { fingerprint: initial.fingerprint },
			})
			if (!created.ok) return created
			setBatchId(created.data.batchId)
			downloadCsv(created.data.csv, created.data.filename)
			router.refresh()
			return created
		})
	}

	return (
		<div className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{blocked ? (
				<Callout tone="warning">
					{blocked}
					{blockedByPayoutSource ? (
						<>
							{" "}
							<Link href="/admin/program">Open Program settings</Link>
						</>
					) : null}
				</Callout>
			) : null}

			<div className="hl-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
				<Button disabled={busy !== null || blocked !== null} onClick={() => setConfirming(true)} variant="primary">
					{busy === "generate" ? "Generating…" : `Generate CSV for ${initial.eligibleCount} card grants`}
				</Button>
				<span className="hl-hint">
					{formatUsd(initial.totalCents / 100)} across {initial.eligibleCount} projects. Upload it to the HCB
					organisation&apos;s card-grant import to create the cards.
				</span>
			</div>

			{batchId ? <p className="hl-hint hl-mono">Generated {batchId} (downloaded)</p> : null}

			<Modal onClose={() => setConfirming(false)} open={confirming} title="Generate HCB import file">
				<p>
					This writes a CSV with <strong>{initial.eligibleCount}</strong> card grants totalling{" "}
					<strong>{formatUsd(initial.totalCents / 100)}</strong>, then downloads it. Upload it on HCB to create the
					cards; HCB emails each recipient.
				</p>
				<p className="hl-hint">
					The {initial.eligibleCount} projects are recorded as exported, so they drop out of future previews and cannot
					land in a second file.
				</p>
				<div className="hl-row" style={{ justifyContent: "flex-end" }}>
					<Button onClick={() => setConfirming(false)} type="button">
						Cancel
					</Button>
					<Button disabled={busy !== null || blocked !== null} onClick={generate} type="button" variant="primary">
						{busy === "generate" ? "Generating…" : `Generate ${initial.eligibleCount} grants`}
					</Button>
				</div>
			</Modal>
		</div>
	)
}
