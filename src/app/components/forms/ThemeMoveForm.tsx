"use client"
import { useState } from "react"
import { Button, Callout, Select } from "@/app/components/ui"
import { useConfirm } from "@/app/components/ui/useConfirm"
import { THEMES, themeLabel, WARMUP_THEME } from "@/lib/config/program"
import type { Theme } from "@/lib/enums"
import { sendJson, useAction } from "@/lib/use-action"

const OPTIONS = [WARMUP_THEME, ...THEMES]

/**
 * Re-file a project on another theme/week. The review state, tier and grant travel with it – this only changes which slot it occupies, so a warm-up can become week 1.
 */
export function ThemeMoveForm({ projectId, current }: Readonly<{ projectId: string; current: Theme }>) {
	const [value, setValue] = useState<Theme>(current)
	const { busy, error, run } = useAction()

	const { confirm, dialog } = useConfirm()

	async function save() {
		if (value === current) return
		const from = themeLabel(current)
		const to = themeLabel(value)
		if (
			(await confirm({
				confirmLabel: "Move project",
				message: "Its reviews and grant move with it.",
				title: `Move this project from ${from} to ${to}?`,
			})) === null
		)
			return
		void run("save", () =>
			sendJson(`/api/admin/theme-projects/${projectId}`, { body: { theme: value }, method: "PATCH" }),
		)
	}

	return (
		<div className="hl-stack hl-stack--tight">
			{dialog}
			<div className="hl-manage-controls">
				<Select
					aria-label="Move project to theme"
					onChange={e => {
						const picked = OPTIONS.find(t => t.id === e.target.value)
						if (picked) setValue(picked.id)
					}}
					style={{ maxWidth: "12rem" }}
					value={value}
				>
					{OPTIONS.map(t => (
						<option key={t.id} value={t.id}>
							{themeLabel(t.id)}
						</option>
					))}
				</Select>
				<div className="hl-manage-actions">
					<Button disabled={busy !== null || value === current} onClick={() => void save()} type="button">
						{busy ? "Moving…" : "Move"}
					</Button>
				</div>
			</div>
			{error ? <Callout tone="danger">{error}</Callout> : null}
		</div>
	)
}
