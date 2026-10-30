"use client"
import { useId, useState } from "react"
import { Button } from "@/components/platform/ui"
import { WARMUP_WEEK_ID } from "@/lib/config/program"
import { formatShortDate } from "@/lib/deadline"
import { useStore } from "@/lib/store"
import type { Checkpoint } from "@/lib/types"
import { weekName } from "./checkpoint-shared"
import { Modal, ModalTitle } from "./Modal"

/* ================================================================== *
 * Submit gate
 * ================================================================== */
/**
 * A Submit checkpoint whose week is already handed in and waiting for review.
 *
 * Opening it again is almost always "I need to change something", so it says where the week stands and offers the one thing that allows a change: taking it back out of review. Nothing is lost by it – the entries, parts list and details stay as they are, and this same checkpoint hands it in again.
 */
export function UnsubmitModal({ checkpoint }: { checkpoint: Checkpoint }) {
	const { setOpenCheckpoint, unsubmitPhase, weekOfCheckpoint, stateOf } = useStore()
	const week = weekOfCheckpoint(checkpoint)
	const handedIn = stateOf(checkpoint.id).at
	const titleId = useId()
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function unsubmit() {
		setBusy(true)
		setError(null)
		const refused = await unsubmitPhase(checkpoint.id)
		setBusy(false)
		if (refused) setError(refused)
		else setOpenCheckpoint(null)
	}

	return (
		<Modal
			accent="var(--color-violet)"
			eyebrow={`${weekName(week)} · ${checkpoint.title}`}
			footer={
				<>
					{error && (
						<p className="hand mr-auto min-w-0 flex-1 text-[0.84rem] leading-snug text-coral-deep" role="alert">
							{error}
						</p>
					)}
					<Button disabled={busy} onClick={() => setOpenCheckpoint(null)} variant="outline">
						Keep it in review
					</Button>
					<Button disabled={busy} onClick={() => unsubmit()} variant="solid">
						{busy ? "Unsubmitting…" : week.id === WARMUP_WEEK_ID ? "Unsubmit your warm-up" : `Unsubmit week ${week.id}`}
					</Button>
				</>
			}
			labelledBy={titleId}
			onClose={() => setOpenCheckpoint(null)}
			open
			size="md"
		>
			<ModalTitle
				id={titleId}
				sub={`${handedIn ? `Submitted ${formatShortDate(handedIn)}. ` : ""}Unsubmitting takes it out of the review queue so you can change your entries, parts list or project details. Submit it again from this checkpoint when you're done.`}
			>
				This week is waiting for review
			</ModalTitle>
		</Modal>
	)
}
