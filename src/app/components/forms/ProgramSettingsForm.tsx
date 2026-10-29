"use client"
import { useState } from "react"
import { Button, Callout, Field, Select, TextInput } from "@/app/components/ui"
import { PayoutSource } from "@/lib/enums"
import { sendJson, useAction } from "@/lib/use-action"

export function ProgramSettingsForm({
	initial,
}: Readonly<{
	initial: {
		programTimezone: string
		submissionsOpen: boolean
		submissionsCloseAt: string | null
		shopOpen: boolean
		shopClosesAt: string | null
		shopGraceDays: number
		reviewClaimTtlMinutes: number
		airtableSyncEnabled: boolean
		payoutSource: PayoutSource
		repoSyncEnabled: boolean
	}
}>) {
	const [form, setForm] = useState(initial)
	const [saved, setSaved] = useState(false)
	const { busy, error, run } = useAction()

	function submit(e: React.SubmitEvent) {
		e.preventDefault()
		setSaved(false)
		void run(
			"submit",
			() =>
				sendJson("/api/admin/program", {
					// The start date has its own form (ProgramStartForm): moving it moves every week's lock, so it is not something to change in passing.
					body: {
						airtableSyncEnabled: form.airtableSyncEnabled,
						payoutSource: form.payoutSource,
						programTimezone: form.programTimezone,
						repoSyncEnabled: form.repoSyncEnabled,
						reviewClaimTtlMinutes: form.reviewClaimTtlMinutes,
						shopClosesAt: form.shopClosesAt ? new Date(`${form.shopClosesAt}Z`).toISOString() : null,
						shopGraceDays: form.shopGraceDays,
						shopOpen: form.shopOpen,
						submissionsCloseAt: form.submissionsCloseAt ? new Date(`${form.submissionsCloseAt}Z`).toISOString() : null,
						submissionsOpen: form.submissionsOpen,
					},
					method: "PATCH",
				}),
			() => setSaved(true),
		)
	}

	return (
		<form className="hl-stack hl-stack--tight" onSubmit={submit}>
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{saved ? <Callout>Saved.</Callout> : null}

			<Field hint="Used for week boundaries and journal dates." label="Timezone">
				<TextInput onChange={e => setForm({ ...form, programTimezone: e.target.value })} value={form.programTimezone} />
			</Field>

			<label className="hl-row" style={{ gap: "0.5rem" }}>
				<input
					checked={form.submissionsOpen}
					onChange={e => setForm({ ...form, submissionsOpen: e.target.checked })}
					type="checkbox"
				/>
				<span>Submissions open</span>
			</label>

			<Field
				hint="Closes submissions at this instant even while the toggle is on. Blank never closes."
				label="Submissions close (UTC, optional)"
			>
				<TextInput
					onChange={e => setForm({ ...form, submissionsCloseAt: e.target.value || null })}
					type="datetime-local"
					value={form.submissionsCloseAt ?? ""}
				/>
			</Field>

			<label className="hl-row" style={{ gap: "0.5rem" }}>
				<input
					checked={form.shopOpen}
					onChange={e => setForm({ ...form, shopOpen: e.target.checked })}
					type="checkbox"
				/>
				<span>Shop open</span>
			</label>

			<Field
				hint="Closes the shop at this instant; the grace window still applies after a review."
				label="Shop closes (UTC, optional)"
			>
				<TextInput
					onChange={e => setForm({ ...form, shopClosesAt: e.target.value || null })}
					type="datetime-local"
					value={form.shopClosesAt ?? ""}
				/>
			</Field>

			<Field
				hint="Which system pays makers. Airtable keeps the submission evidence and Loops columns either way; under HCB its Requested funding column is written as zero so the YSWS pipeline cannot pay twice."
				label="Payout source"
			>
				<Select
					onChange={e => setForm({ ...form, payoutSource: e.target.value as PayoutSource })}
					value={form.payoutSource}
				>
					<option value={PayoutSource.AIRTABLE}>Airtable / YSWS pipeline</option>
					<option value={PayoutSource.HCB}>HCB card grants</option>
				</Select>
			</Field>

			<label className="hl-row" style={{ gap: "0.5rem" }}>
				<input
					checked={form.airtableSyncEnabled}
					onChange={e => setForm({ ...form, airtableSyncEnabled: e.target.checked })}
					type="checkbox"
				/>
				<span>Push approvals to Airtable</span>
			</label>

			<label className="hl-row" style={{ gap: "0.5rem" }}>
				<input
					checked={form.repoSyncEnabled}
					onChange={e => setForm({ ...form, repoSyncEnabled: e.target.checked })}
					type="checkbox"
				/>
				<span>Sync devlogs and BOMs to repos</span>
			</label>

			<Field hint="How long the shop stays open after someone's last review." label="Shop grace days">
				<TextInput
					max="90"
					min="0"
					onChange={e => setForm({ ...form, shopGraceDays: Number(e.target.value) })}
					type="number"
					value={form.shopGraceDays}
				/>
			</Field>

			<Field label="Review claim TTL (minutes)">
				<TextInput
					max="240"
					min="5"
					onChange={e => setForm({ ...form, reviewClaimTtlMinutes: Number(e.target.value) })}
					type="number"
					value={form.reviewClaimTtlMinutes}
				/>
			</Field>

			<div>
				<Button disabled={busy !== null} type="submit" variant="primary">
					{busy ? "Saving…" : "Save settings"}
				</Button>
			</div>
		</form>
	)
}
