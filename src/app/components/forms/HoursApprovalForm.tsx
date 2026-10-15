"use client"

import { useState } from "react"
import { Callout } from "@/app/components/ui"
import { sendJson, useAction } from "@/lib/use-action"

type Kind = "session" | "hackatime"

/**
 * Approve one entry's hours, which is what `WorkSession.hoursApproved` and `HackatimeLink.hoursApproved` exist for: a reviewer deflating one bad entry before the phase total is computed from it.
 *
 * Only rendered while the reviewer holds the claim, because the route refuses a batch another reviewer's live claim covers – showing the field without a claim would be an input that always errors.
 */
export function HoursApprovalForm(
	props: Readonly<{ kind: Kind; id: string; claimed: boolean; approved: number | null }>,
) {
	if (!props.claimed) return null
	return <HoursApprovalFormInner {...props} />
}

function HoursApprovalFormInner({ kind, id, approved }: Readonly<{ kind: Kind; id: string; approved: number | null }>) {
	const [value, setValue] = useState(approved === null ? "" : String(approved))
	const { busy, error, run, refuse } = useAction()

	function save() {
		const hoursApproved = Number(value)
		if (value.trim() === "" || !Number.isFinite(hoursApproved) || hoursApproved < 0) {
			refuse("Enter a number of hours")
			return
		}
		void run("save", () => sendJson("/api/review/hours", { body: { decisions: [{ kind, id, hoursApproved }] } }))
	}

	return (
		<form
			className="hl-stack hl-stack--tight"
			onSubmit={e => {
				e.preventDefault()
				save()
			}}
			style={{ gap: "0.3rem", minWidth: "6rem" }}
		>
			<input
				aria-label="Approved hours"
				className="hl-input"
				disabled={busy !== null}
				max={kind === "session" ? 24 : 2000}
				min={0}
				onChange={e => setValue(e.target.value)}
				step={0.25}
				type="number"
				value={value}
			/>
			<button className="hl-btn" disabled={busy !== null} type="submit">
				Save
			</button>
			{error ? <Callout tone="danger">{error}</Callout> : null}
		</form>
	)
}
