"use client"
import { useState } from "react"
import { Button, Callout } from "@/app/components/ui"
import type { Theme } from "@/app/generated/prisma/enums"
import { getThemeDef, THEMES, WARMUP_THEME } from "@/lib/config/program"
import { sendJson, useAction } from "@/lib/use-action"

const OPTIONS = [WARMUP_THEME, ...THEMES]

/**
 * Re-file a project on another theme/week. The review state, tier and grant travel with it – this only changes which slot it occupies, so a warm-up can become week 1.
 */
export function ThemeMoveForm({ projectId, current }: Readonly<{ projectId: string; current: Theme }>) {
	const [value, setValue] = useState<Theme>(current)
	const { busy, error, run } = useAction()

	function save() {
		if (value === current) return
		const from = getThemeDef(current).label
		const to = getThemeDef(value).label
		if (!window.confirm(`Move this project from ${from} to ${to}? Its reviews and grant move with it.`)) return
		void run("save", () =>
			sendJson(`/api/admin/theme-projects/${projectId}`, { body: { theme: value }, method: "PATCH" }),
		)
	}

	return (
		<div className="hl-stack hl-stack--tight">
			<div className="hl-row">
				<select
					aria-label="Move project to theme"
					className="hl-input"
					onChange={e => setValue(e.target.value as Theme)}
					style={{ maxWidth: "12rem" }}
					value={value}
				>
					{OPTIONS.map(t => (
						<option key={t.id} value={t.id}>
							{t.label}
						</option>
					))}
				</select>
				<Button disabled={busy !== null || value === current} onClick={save} type="button">
					{busy ? "Moving…" : "Move"}
				</Button>
			</div>
			{error ? <Callout tone="danger">{error}</Callout> : null}
		</div>
	)
}
