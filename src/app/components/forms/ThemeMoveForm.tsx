"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout } from "@/app/components/ui"
import { Theme } from "@/app/generated/prisma/enums"
import { getThemeDef, THEMES, WARMUP_THEME } from "@/lib/config/program"

const OPTIONS = [WARMUP_THEME, ...THEMES]

/**
 * Re-file a project on another theme/week. The review state, tier and grant travel with it – this only changes which slot it occupies, so a warm-up can become week 1.
 */
export function ThemeMoveForm({
	projectId,
	current,
}: Readonly<{ projectId: string; current: Theme }>) {
	const router = useRouter()
	const [value, setValue] = useState<Theme>(current)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function save() {
		if (value === current) return
		const from = getThemeDef(current).label
		const to = getThemeDef(value).label
		if (!window.confirm(`Move this project from ${from} to ${to}? Its reviews and grant move with it.`)) return
		setBusy(true)
		setError(null)
		try {
			const res = await fetch(`/api/admin/theme-projects/${projectId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ theme: value }),
			})
			if (!res.ok) {
				const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
				setError(payload.error?.message ?? `Failed (${res.status})`)
				return
			}
			router.refresh()
		} catch (err) {
			setError(err instanceof Error ? err.message : "Request failed")
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="hl-stack hl-stack--tight">
			<div className="hl-row">
				<select
					className="hl-input"
					value={value}
					onChange={(e) => setValue(e.target.value as Theme)}
					aria-label="Move project to theme"
					style={{ maxWidth: "12rem" }}
				>
					{OPTIONS.map((t) => (
						<option key={t.id} value={t.id}>
							{t.label}
						</option>
					))}
				</select>
				<Button type="button" disabled={busy || value === current} onClick={save}>
					{busy ? "Moving…" : "Move"}
				</Button>
			</div>
			{error ? <Callout tone="danger">{error}</Callout> : null}
		</div>
	)
}
