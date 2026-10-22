"use client"
import { useState } from "react"
import { Button, Callout } from "@/app/components/ui"
import { sendJson, useAction } from "@/lib/use-action"

/** Set what one unit of an item costs Hack Club, from the catalogue row. */
export function ItemCostField({ itemId, costUsd }: Readonly<{ itemId: string; costUsd: number | null }>) {
	const [value, setValue] = useState(costUsd === null ? "" : String(costUsd))
	const { busy, error, run } = useAction()
	const dirty = value !== (costUsd === null ? "" : String(costUsd))

	function submit(e: React.SubmitEvent) {
		e.preventDefault()
		void run("submit", () =>
			sendJson(`/api/admin/shop/items/${itemId}`, {
				body: { costUsd: value === "" ? null : Number(value) },
				method: "PATCH",
			}),
		)
	}

	return (
		<form className="hl-row" onSubmit={submit} style={{ flexWrap: "nowrap", gap: "0.4rem" }}>
			<input
				aria-label="Cost in USD"
				className="hl-input"
				min="0"
				onChange={e => setValue(e.target.value)}
				placeholder="not set"
				step="0.01"
				style={{ width: "7rem" }}
				type="number"
				value={value}
			/>
			{dirty ? (
				<Button disabled={busy !== null} type="submit">
					{busy ? "Saving…" : "Save"}
				</Button>
			) : null}
			{error ? <Callout tone="danger">{error}</Callout> : null}
		</form>
	)
}
