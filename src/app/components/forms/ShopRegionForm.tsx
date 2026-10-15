"use client"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"
import { sendJson, useAction } from "@/lib/use-action"

/**
 * Add a sales region. The slug is fixed once created – orders snapshot prices, and analytics refers to regions by id – so it should not change.
 */
export function ShopRegionForm() {
	const [id, setId] = useState("")
	const [name, setName] = useState("")
	const { busy, error, run } = useAction()

	function submit(e: React.FormEvent) {
		e.preventDefault()
		void run(
			"submit",
			() => sendJson("/api/admin/shop/regions", { body: { id: id.trim(), name: name.trim() } }),
			() => {
				setId("")
				setName("")
			},
		)
	}

	return (
		<form className="hl-stack hl-stack--tight" onSubmit={submit}>
			{error ? <Callout tone="danger">{error}</Callout> : null}
			<div className="hl-row">
				<Field label="Slug">
					<input
						className="hl-input hl-mono"
						onChange={e => setId(e.target.value)}
						pattern="[a-z0-9][a-z0-9-]*"
						placeholder="eu"
						required
						value={id}
					/>
				</Field>
				<Field label="Name">
					<input
						className="hl-input"
						onChange={e => setName(e.target.value)}
						placeholder="Europe"
						required
						value={name}
					/>
				</Field>
			</div>
			<div>
				<Button disabled={busy !== null} type="submit" variant="primary">
					{busy ? "Adding…" : "Add region"}
				</Button>
			</div>
			<p className="hl-hint">Lowercase, hyphens. Appears in analytics, so it should not change.</p>
		</form>
	)
}
