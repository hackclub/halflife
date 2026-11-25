"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout, EmptyState, Field, Panel, TextArea, TextInput } from "@/app/components/ui"
import { useConfirm } from "@/app/components/ui/useConfirm"
import { sendJson, useAction } from "@/lib/use-action"

export interface GrantCardMerchantRow {
	archived: boolean
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
export function GrantCardMerchantsPanel({
	archived,
	merchants,
}: Readonly<{ archived: boolean; merchants: readonly GrantCardMerchantRow[] }>) {
	return (
		<>
			{archived ? null : <NewMerchantPanel />}
			{merchants.length === 0 ? (
				<Panel title={archived ? "Archived" : "Merchants"}>
					<EmptyState>{archived ? "No archived merchants." : "No merchants yet."}</EmptyState>
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
			<div className="hl-field-pair hl-field-pair--wide">
				<Field label="Name">
					<TextInput onChange={e => setName(e.target.value)} value={name} />
				</Field>
				<Field hint="Where the IDs came from, for example yellow_pages: Amazon." label="Source">
					<TextInput onChange={e => setSourceNote(e.target.value)} value={sourceNote} />
				</Field>
			</div>
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

	async function archive() {
		const answer = await confirm({
			confirmLabel: "Archive merchant",
			message: `Archive ${merchant.name}? Its ${merchant.merchantIds.length} ${merchant.merchantIds.length === 1 ? "ID" : "IDs"} are kept, and it can be restored from the archived tab. No item can be linked to it while it is archived.`,
			title: `Archive ${merchant.name}`,
		})
		if (answer === null) return
		setError(null)
		void run(
			"archive",
			() => sendJson(`/api/admin/shop/merchants/${merchant.id}`, { body: { archived: true }, method: "PATCH" }),
			() => router.refresh(),
		)
	}

	function restore() {
		setError(null)
		void run(
			"restore",
			() => sendJson(`/api/admin/shop/merchants/${merchant.id}`, { body: { archived: false }, method: "PATCH" }),
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
			<div className="hl-field-pair hl-field-pair--wide">
				<Field label="Name">
					<TextInput onChange={e => setName(e.target.value)} value={name} />
				</Field>
				<Field label="Source">
					<TextInput onChange={e => setSourceNote(e.target.value)} value={sourceNote} />
				</Field>
			</div>
			<Field
				hint={`${parseIds(idsText).length} ${parseIds(idsText).length === 1 ? "ID" : "IDs"}. Commas, spaces or line breaks.`}
				label="Merchant IDs"
			>
				<TextArea onChange={e => setIdsText(e.target.value)} rows={4} value={idsText} />
			</Field>
			<div className="hl-row" style={{ alignItems: "center", gap: "0.75rem" }}>
				<Button disabled={busy !== null || name.trim() === ""} onClick={save} type="button" variant="primary">
					{busy === "save" ? "Saving…" : "Save changes"}
				</Button>
				{merchant.archived ? (
					<Button disabled={busy !== null} onClick={restore} type="button">
						{busy === "restore" ? "Restoring…" : "Restore"}
					</Button>
				) : (
					<Button disabled={busy !== null || merchant.itemCount > 0} onClick={() => void archive()} type="button">
						{busy === "archive" ? "Archiving…" : "Archive merchant"}
					</Button>
				)}
				{merchant.itemCount > 0 && !merchant.archived ? (
					<span className="hl-hint">Unlink it from its items before archiving.</span>
				) : null}
			</div>
			{dialog}
		</Panel>
	)
}
