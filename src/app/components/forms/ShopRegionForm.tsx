"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"

/**
 * Add a sales region. The slug is fixed once created — orders snapshot
 * prices, and analytics refers to regions by id — so it should not change.
 */
export function ShopRegionForm() {
	const router = useRouter()
	const [id, setId] = useState("")
	const [name, setName] = useState("")
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function submit(e: React.FormEvent) {
		e.preventDefault()
		setBusy(true)
		setError(null)
		try {
			const res = await fetch("/api/admin/shop/regions", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: id.trim(), name: name.trim() }),
			})
			if (!res.ok) {
				const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
				setError(payload.error?.message ?? `Failed (${res.status})`)
				return
			}
			setId("")
			setName("")
			router.refresh()
		} catch {
			setError("Could not reach the server")
		} finally {
			setBusy(false)
		}
	}

	return (
		<form onSubmit={submit} className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}
			<div className="hl-row">
				<Field label="Slug">
					<input
						className="hl-input hl-mono"
						value={id}
						required
						pattern="[a-z0-9][a-z0-9-]*"
						placeholder="eu"
						onChange={(e) => setId(e.target.value)}
					/>
				</Field>
				<Field label="Name">
					<input
						className="hl-input"
						value={name}
						required
						placeholder="Europe"
						onChange={(e) => setName(e.target.value)}
					/>
				</Field>
			</div>
			<div>
				<Button type="submit" variant="primary" disabled={busy}>
					{busy ? "Adding…" : "Add region"}
				</Button>
			</div>
			<p className="hl-hint">Lowercase, hyphens. Appears in analytics, so it should not change.</p>
		</form>
	)
}
