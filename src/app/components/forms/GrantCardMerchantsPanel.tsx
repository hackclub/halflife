"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout, EmptyState, Field, Panel, TextArea, TextInput } from "@/app/components/ui"
import { useConfirm } from "@/app/components/ui/useConfirm"
import { sendJson, useAction } from "@/lib/use-action"

export interface GrantCardMerchantRow {
	id: string
	itemCount: number
	merchantIds: readonly string[]
	name: string
	sourceNote: string
}

/** IDs pasted as commas, spaces or line breaks, trimmed and deduplicated, so a yellow_pages block can be pasted whole. */
function parseIds(value: string): string[] {
	return [
		...new Set(
			value
				.split(/[\s,]+/)
				.map(id => id.trim())
				.filter(Boolean),
		),
	]
}

/** The merchants a grant card can be spent at, each with its IDs. Edits recompute every linked item's list at once. */
export function GrantCardMerchantsPanel({ merchants }: Readonly<{ merchants: readonly GrantCardMerchantRow[] }>) {
	return (
		<>
			<NewMerchantPanel />
			{merchants.length === 0 ? (
				<Panel title="Merchants">
					<EmptyState>No merchants yet.</EmptyState>
				</Panel>
			) : (
				merchants.map(merchant => <MerchantPanel key={merchant.id} merchant={merchant} />)
			)}
		</>
	)
}

function NewMerchantPanel() {
	const router = useRouter()
	const [name, setName] = useState("")
	const [sourceNote, setSourceNote] = useState("")
	const [idsText, setIdsText] = useState("")
	const { busy, error, run } = useAction()

	function create() {
		void run(
			"create",
			() =>
				sendJson("/api/admin/shop/merchants", {
					body: { merchantIds: parseIds(idsText), name, sourceNote },
					method: "POST",
				}),
			() => {
				setName("")
				setSourceNote("")
				setIdsText("")
				router.refresh()
			},
		)
	}

	return (
		<Panel title="Add a merchant">
			{error ? <Callout tone="danger">{error}</Callout> : null}
			<Field label="Name">
				<TextInput onChange={e => setName(e.target.value)} value={name} />
			</Field>
			<Field hint="Where the IDs came from, for example yellow_pages: Amazon." label="Source">
				<TextInput onChange={e => setSourceNote(e.target.value)} value={sourceNote} />
			</Field>
			<Field hint="Commas, spaces or line breaks. No limit on how many." label="Merchant IDs">
				<TextArea onChange={e => setIdsText(e.target.value)} rows={4} value={idsText} />
			</Field>
			<div className="hl-savebar">
				<Button disabled={busy !== null || name.trim() === ""} onClick={create} type="button" variant="primary">
					{busy === "create" ? "Adding…" : "Add merchant"}
				</Button>
			</div>
		</Panel>
	)
}

function MerchantPanel({ merchant }: Readonly<{ merchant: GrantCardMerchantRow }>) {
	const router = useRouter()
	const [name, setName] = useState(merchant.name)
	const [sourceNote, setSourceNote] = useState(merchant.sourceNote)
	const [idsText, setIdsText] = useState(merchant.merchantIds.join(", "))
	const [saved, setSaved] = useState(false)
	const { busy, error, run, setError } = useAction()
	const { confirm, dialog } = useConfirm()

	function save() {
		setSaved(false)
		void run(
			"save",
			() =>
				sendJson(`/api/admin/shop/merchants/${merchant.id}`, {
					body: { merchantIds: parseIds(idsText), name, sourceNote },
					method: "PATCH",
				}),
			() => {
				setSaved(true)
				router.refresh()
			},
		)
	}

	async function remove() {
		const answer = await confirm({
			confirmLabel: "Delete merchant",
			message: `Delete ${merchant.name} and its ${merchant.merchantIds.length} IDs? This cannot be undone.`,
			title: `Delete ${merchant.name}`,
		})
		if (answer === null) return
		setError(null)
		void run(
			"delete",
			() => sendJson(`/api/admin/shop/merchants/${merchant.id}`, { method: "DELETE" }),
			() => router.refresh(),
		)
	}

	return (
		<Panel
			actions={<span className="hl-hint">{merchant.itemCount === 1 ? "1 item" : `${merchant.itemCount} items`}</span>}
			title={merchant.name}
		>
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{saved ? <Callout>Saved. Linked items were recomputed.</Callout> : null}
			<Field label="Name">
				<TextInput onChange={e => setName(e.target.value)} value={name} />
			</Field>
			<Field label="Source">
				<TextInput onChange={e => setSourceNote(e.target.value)} value={sourceNote} />
			</Field>
			<Field hint={`${parseIds(idsText).length} IDs. Commas, spaces or line breaks.`} label="Merchant IDs">
				<TextArea onChange={e => setIdsText(e.target.value)} rows={4} value={idsText} />
			</Field>
			<div className="hl-row" style={{ alignItems: "center", gap: "0.75rem" }}>
				<Button disabled={busy !== null || name.trim() === ""} onClick={save} type="button" variant="primary">
					{busy === "save" ? "Saving…" : "Save changes"}
				</Button>
				<Button disabled={busy !== null || merchant.itemCount > 0} onClick={() => void remove()} type="button">
					{busy === "delete" ? "Deleting…" : "Delete"}
				</Button>
				{merchant.itemCount > 0 ? <span className="hl-hint">Unlink it from its items before deleting.</span> : null}
			</div>
			{dialog}
		</Panel>
	)
}
