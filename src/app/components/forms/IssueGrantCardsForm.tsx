"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { z } from "zod"
import { Badge, Button, Callout, Modal, Table } from "@/app/components/ui"
import { formatUsd } from "@/lib/money"
import { type SendResult, sendJsonParsed, useAction } from "@/lib/use-action"

const PreviewRow = z.object({
	amountCents: z.number(),
	bomLineCount: z.number(),
	email: z.string(),
	grantUsd: z.number().nullable(),
	ownerId: z.string(),
	ownerName: z.string(),
	projectId: z.string(),
	theme: z.string(),
	title: z.string(),
})

const ExclusionRow = z.object({
	ownerName: z.string(),
	projectId: z.string(),
	reason: z.string(),
	title: z.string(),
})

const PreviewSchema = z.object({
	balanceCents: z.number().nullable(),
	balanceError: z.string().nullable(),
	canIssue: z.boolean(),
	configured: z.boolean(),
	eligible: z.array(PreviewRow),
	excluded: z.array(ExclusionRow),
	fingerprint: z.string(),
	payoutSource: z.string(),
	totalCents: z.number(),
})

const Batch = z.object({
	batchId: z.string(),
	totalCents: z.number(),
})

const ProcessOutcomeSchema = z.object({
	amountCents: z.number(),
	error: z.string().nullable(),
	hcbCardGrantId: z.string().nullable(),
	id: z.string(),
	projectId: z.string(),
	status: z.string(),
	title: z.string(),
})

const ProcessResult = z.object({
	batch: z.object({ id: z.string() }),
	outcomes: z.array(ProcessOutcomeSchema),
	remaining: z.number(),
})

type PreviewData = z.infer<typeof PreviewSchema>
type Outcome = z.infer<typeof ProcessOutcomeSchema>

const STATUS_TONE: { [_: string]: "success" | "warning" | "danger" | "muted" } = {
	AMBIGUOUS: "warning",
	FAILED: "danger",
	ISSUED: "success",
	PENDING: "warning",
	SKIPPED: "muted",
}

function statusLabel(status: string): string {
	return status.toLowerCase().replaceAll("_", " ")
}

/** What the preview is missing, in words an admin can act on. */
function blockedReason(preview: PreviewData): string | null {
	if (preview.payoutSource !== "HCB")
		return "Payout source is still Airtable. Switch it to HCB card grants in Program settings."
	if (!preview.configured) return "HCB is not configured on this deployment."
	if (preview.balanceCents === null) return preview.balanceError ?? "HCB balance could not be read."
	if (preview.eligible.length === 0) return "No approved project is ready for a card grant."
	if (preview.totalCents > preview.balanceCents)
		return `The batch totals ${formatUsd(preview.totalCents / 100)}, more than the HCB balance.`
	return null
}

export function IssueGrantCardsForm({ initial }: Readonly<{ initial: PreviewData }>) {
	const router = useRouter()
	const { busy, error, run } = useAction()
	const preview = initial
	const [confirming, setConfirming] = useState(false)
	const [batchId, setBatchId] = useState<string | null>(null)
	const [outcomes, setOutcomes] = useState<Outcome[]>([])
	const [remaining, setRemaining] = useState(0)
	// The preview refreshes once the run ends and those projects are no longer eligible, so the total is captured here.
	const [batchTotal, setBatchTotal] = useState(0)
	const [finished, setFinished] = useState(false)
	const blocked = blockedReason(preview)

	async function processBatch(id: string): Promise<SendResult<unknown>> {
		for (let round = 0; round < 200; round++) {
			const result: SendResult<z.infer<typeof ProcessResult>> = await sendJsonParsed(
				ProcessResult,
				`/api/admin/grant-cards/batches/${id}/process`,
				{ body: {} },
			)
			if (!result.ok) {
				setFinished(true)
				return result
			}
			setOutcomes(current => [...current, ...result.data.outcomes])
			setRemaining(result.data.remaining)
			if (result.data.remaining === 0) {
				setFinished(true)
				return { data: result.data, ok: true }
			}
			// Nothing was claimed this round, so another request holds the rest. Asking again in a tight loop would only
			// hammer the route; the batch is resumable once those claims expire.
			if (result.data.outcomes.length === 0) {
				setFinished(true)
				return {
					message: "The remaining grants are already being processed. Resume this batch in a few minutes.",
					ok: false,
				}
			}
		}
		setFinished(true)
		return {
			message: "The batch did not finish after 200 rounds. Resume it from the recent batches list.",
			ok: false,
		}
	}

	function issue() {
		setConfirming(false)
		setOutcomes([])
		setBatchTotal(preview.eligible.length)
		setRemaining(preview.eligible.length)
		setFinished(false)
		void run("issue", async () => {
			try {
				const created = await sendJsonParsed(Batch, "/api/admin/grant-cards/batches", {
					body: { fingerprint: preview.fingerprint },
				})
				if (!created.ok) return created
				setBatchId(created.data.batchId)
				const processedBatch = await processBatch(created.data.batchId)
				return processedBatch.ok ? created : processedBatch
			} finally {
				// Rows may have been paid even when the run ends in an error, so the preview is stale either way.
				router.refresh()
			}
		})
	}

	const issued = outcomes.filter(outcome => outcome.status === "ISSUED")
	const amountIssued = issued.reduce((total, outcome) => total + outcome.amountCents, 0)
	const processed = outcomes.length

	return (
		<div className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{blocked ? <Callout tone="warning">{blocked}</Callout> : null}

			<div className="hl-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
				<Button disabled={busy !== null || blocked !== null} onClick={() => setConfirming(true)} variant="primary">
					{busy === "issue" ? "Issuing…" : `Issue ${preview.eligible.length} card grants`}
				</Button>
				<span className="hl-hint">
					{formatUsd(preview.totalCents / 100)} from an HCB balance of{" "}
					{preview.balanceCents === null ? "unknown" : formatUsd(preview.balanceCents / 100)}
				</span>
				<Button onClick={() => window.location.reload()} type="button">
					Reload preview
				</Button>
			</div>

			{processed > 0 ? (
				<div className="hl-stack hl-stack--tight">
					<p className="hl-hint">
						{processed} of {batchTotal} processed, {formatUsd(amountIssued / 100)} issued
						{remaining > 0 ? `, ${remaining} left` : finished ? ", finished" : ""}.
					</p>
					{batchId ? (
						<p className="hl-hint">
							<Link href={`/admin/grants/${batchId}`}>Open the full batch</Link>
						</p>
					) : null}
					<Table head={["Project", "Amount", "Status", "HCB grant", "Error"]}>
						{outcomes.map(outcome => (
							<tr key={outcome.id}>
								<td>{outcome.title || outcome.projectId}</td>
								<td className="hl-mono">{formatUsd(outcome.amountCents / 100)}</td>
								<td>
									<Badge tone={STATUS_TONE[outcome.status] ?? "muted"}>{statusLabel(outcome.status)}</Badge>
								</td>
								<td className="hl-mono">{outcome.hcbCardGrantId ?? "-"}</td>
								<td className="hl-hint">{outcome.error ?? "-"}</td>
							</tr>
						))}
					</Table>
				</div>
			) : null}

			<Modal onClose={() => setConfirming(false)} open={confirming} title="Issue HCB card grants">
				<p>
					This creates <strong>{preview.eligible.length}</strong> HCB card grants, one per project, totalling{" "}
					<strong>{formatUsd(preview.totalCents / 100)}</strong> from the HCB balance of{" "}
					<strong>{preview.balanceCents === null ? "unknown" : formatUsd(preview.balanceCents / 100)}</strong>.
				</p>
				<p className="hl-hint">
					HCB emails each recipient. Projects already paid by top-up or card grant are not included. The amount is each
					project&apos;s BOM total, including tax and shipping.
				</p>
				{batchId ? <p className="hl-hint hl-mono">Batch {batchId}</p> : null}
				<div className="hl-row" style={{ justifyContent: "flex-end" }}>
					<Button onClick={() => setConfirming(false)} type="button">
						Cancel
					</Button>
					<Button disabled={busy !== null || blocked !== null} onClick={issue} type="button" variant="primary">
						{busy === "issue" ? "Issuing…" : `Issue ${preview.eligible.length} grants`}
					</Button>
				</div>
			</Modal>
		</div>
	)
}
