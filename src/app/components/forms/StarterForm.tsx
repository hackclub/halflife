"use client"
import { useState } from "react"
import { Button, Callout, Select } from "@/app/components/ui"
import { starterProjectsFor } from "@/lib/config/onboarding"
import type { Theme } from "@/lib/enums"
import { sendJson, useAction } from "@/lib/use-action"

const NONE = ""

/**
 * Set or clear a project's starter project. The starter has to be one this week offers, and the project has to be Tier 1. The Airtable `Starter project` box follows at the next sync.
 */
export function StarterForm({
	current,
	projectId,
	theme,
}: Readonly<{ current: string | null; projectId: string; theme: Theme }>) {
	const starters = starterProjectsFor(theme)
	const [value, setValue] = useState<string>(current ?? NONE)
	const { busy, error, run } = useAction()

	function save() {
		if (value === (current ?? NONE)) return
		const picked = value === NONE ? null : (starters.find(s => s.id === value)?.title ?? value)
		const message = picked
			? `Set this project's starter to ${picked}? It must be Tier 1 and is recorded in the audit log.`
			: "Clear this project's starter? It is recorded in the audit log."
		if (!window.confirm(message)) return
		void run("save", () =>
			sendJson(`/api/admin/theme-projects/${projectId}`, {
				body: { starterProjectId: value === NONE ? null : value },
				method: "PATCH",
			}),
		)
	}

	return (
		<div className="hl-stack hl-stack--tight">
			<div className="hl-row">
				<Select
					aria-label="Starter project"
					onChange={e => setValue(e.target.value)}
					style={{ maxWidth: "14rem" }}
					value={value}
				>
					<option value={NONE}>No starter</option>
					{starters.map(starter => (
						<option key={starter.id} value={starter.id}>
							{starter.title}
						</option>
					))}
				</Select>
				<Button disabled={busy !== null || value === (current ?? NONE)} onClick={save} type="button">
					{busy ? "Saving…" : "Save starter"}
				</Button>
			</div>
			{error ? <Callout tone="danger">{error}</Callout> : null}
		</div>
	)
}
