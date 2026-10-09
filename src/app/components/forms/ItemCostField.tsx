"use client"
import { useState } from "react"
import { Button, Callout } from "@/app/components/ui"
import { sendJson, useAction } from "@/lib/use-action"

/** Set what one unit of an item costs Hack Club, from the catalogue row. */
export function ItemCostField({ itemId, costUsd }: Readonly<{ itemId: string; costUsd: number | null }>) {
	const [value, setValue] = useState(costUsd === null ? "" : String(costUsd))
	const { busy, error, run } = useAction()
	const dirty = value !== (costUsd === null ? "" : String(costUsd))

	function submit(e: React.FormEvent) {
		e.preventDefault()
		void run("submit", () =>
			sendJson(`/api/admin/shop/items/${itemId}`, {
				method: "PATCH",
				body: { costUsd: value === "" ? null : Number(value) },
			}),
		)
	}

	return (
		<form onSubmit={submit} className="hl-row" style={{ gap: "0.4rem", flexWrap: "nowrap" }}>
			<input
				className="hl-input"
				type="number"
				min="0"
				step="0.01"
				aria-label="Cost in USD"
				placeholder="not set"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				style={{ width: "7rem" }}
			/>
			{dirty ? (
				<Button type="submit" disabled={busy !== null}>
					{busy ? "Saving…" : "Save"}
				</Button>
			) : null}
			{error ? <Callout tone="danger">{error}</Callout> : null}
		</form>
	)
}
