"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId, useRef, useState } from "react"
import { IconArrowDown, IconPencil, IconPlus, IconX } from "@/components/platform/icons"
import { Button } from "@/components/platform/ui"
import { BOM_MARGIN_USD, bomTotalUsd } from "@/lib/bom-policy"
import type { BomLine } from "@/lib/bom-schema"
import { cx } from "@/lib/cx"
import { formatUsd, round2 } from "@/lib/money"
import { BomImportDialog } from "./BomImportDialog"
import { BomLineForm } from "./BomLineForm"
import {
	BomPayloadSchema,
	type Draft,
	draftOf,
	EMPTY,
	FIELD_NAMES,
	parsePrice,
	requiredMessage,
} from "./bom-editor-model"

/**
 * The parts list, kept here rather than typed out at submission time.
 *
 * One table, one form. The form sits under the table and serves both adding and editing, so the table itself never grows inputs and stays readable at phone width with a horizontal scroll. The total is read against the tier's funding because that is the question the list answers: does this project fit the money it is asking for.
 *
 * Tax and shipping close the table as one fixed line for the whole order. It has an amount and nothing else – no edit form and no remove – because every order has it, even at zero.
 */
/** One parts line, read-only until the maker presses edit or remove. */
function BomLineRow({
	editing,
	line,
	locked,
	onEdit,
	onRemove,
	saving,
}: {
	editing: boolean
	line: BomLine
	locked: string | null
	onEdit(line: BomLine): void
	onRemove(line: BomLine): void
	saving: boolean
}) {
	return (
		<tr className={cx("border-b border-dashed border-line/60 align-top", editing && "bg-violet-pale/50")}>
			<td className="py-2.5 pr-3">
				<span className="block font-semibold [overflow-wrap:anywhere] text-navy">{line.name}</span>
				{line.purpose && <span className="block text-[0.8rem] leading-snug text-navy-soft">{line.purpose}</span>}
			</td>
			<td className="px-3 py-2.5 tabular-nums">{line.quantity}</td>
			<td className="px-3 py-2.5 tabular-nums">{formatUsd(line.unitCostUsd)}</td>
			<td className="px-3 py-2.5 font-semibold text-navy tabular-nums">
				{formatUsd(line.quantity * line.unitCostUsd)}
			</td>
			<td className="hand px-3 py-2.5 text-navy-soft">
				{line.link ? (
					<a
						className="underline decoration-line-strong underline-offset-4 hover:text-navy hover:decoration-violet"
						href={line.link}
						rel="noopener noreferrer"
						target="_blank"
					>
						{line.vendor || "link"}
					</a>
				) : (
					line.vendor || "-"
				)}
			</td>
			{!locked && (
				<td className="py-1.5 pl-2 whitespace-nowrap">
					<button
						aria-label={`Edit ${line.name}`}
						className="inline-grid size-8 place-items-center rounded-full text-navy-soft transition-colors hover:bg-black/5 hover:text-navy"
						disabled={saving}
						onClick={() => onEdit(line)}
						type="button"
					>
						<IconPencil className="text-sm" />
					</button>
					<button
						aria-label={`Remove ${line.name}`}
						className="inline-grid size-8 place-items-center rounded-full text-navy-soft transition-colors hover:bg-coral/10 hover:text-coral-deep"
						disabled={saving}
						onClick={() => onRemove(line)}
						type="button"
					>
						<IconX className="text-sm" />
					</button>
				</td>
			)}
		</tr>
	)
}

export function BomEditor({
	projectId,
	items: initial,
	taxShippingUsd: initialExtra,
	locked,
	tier,
	grantUsd,
}: {
	projectId: string
	items: BomLine[]
	taxShippingUsd: number
	/** Why the list cannot change, or null when it can. */
	locked: string | null
	tier: number
	grantUsd: number
}) {
	const router = useRouter()
	const [items, setItems] = useState(initial)
	// null: form closed. "new": adding. Otherwise the id of the line being edited.
	const [editing, setEditing] = useState<string | null>(null)
	const [draft, setDraft] = useState<Draft>(EMPTY)
	const nameInput = useRef<HTMLInputElement>(null)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	// The fields the last save found missing, outlined until they are filled.
	const [invalid, setInvalid] = useState<Set<keyof Draft>>(new Set())

	const [taxShipping, setTaxShipping] = useState(initialExtra)

	// The repo import, kept apart from the line form: it is one read, a preview, and one confirm, not a field-by-field edit.
	const [importOpen, setImportOpen] = useState(false)

	// The same arithmetic the submit gate reads, so the number warning here is the number being held to there.
	const total = bomTotalUsd(items, taxShipping)
	const over = total > grantUsd
	// Past the funding it warns; past the margin handing it in means partial funding, which the submit sheet asks about.
	const pastMargin = total > grantUsd + BOM_MARGIN_USD

	function open(target: "new" | BomLine) {
		setEditing(target === "new" ? "new" : target.id)
		setDraft(target === "new" ? EMPTY : draftOf(target))
		setError(null)
		setInvalid(new Set())
	}

	async function send(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) {
		setSaving(true)
		setError(null)
		try {
			const res = await fetch(path, {
				body: body ? JSON.stringify(body) : undefined,
				headers: body ? { "content-type": "application/json" } : undefined,
				method,
			})
			const parsed = BomPayloadSchema.safeParse(await res.json().catch(() => null))
			if (!res.ok) {
				// The server's field check says which fields, not just "Invalid request": outline those and say it the way the form's own check does. This catches anything the form let through, like a tab still running an older copy of it.
				const envelope = parsed.success ? parsed.data.error : undefined
				const fields = Object.keys(envelope?.details?.properties ?? {}).filter(
					(k): k is keyof Draft => k in FIELD_NAMES,
				)
				if (envelope?.code === "VALIDATION_FAILED" && fields.length > 0) {
					setInvalid(new Set(fields))
					setError(requiredMessage(fields))
				} else setError(envelope?.message ?? "That did not save. Try again.")

				return false
			}
			if (!parsed.success) {
				setError("The server's answer was not in the expected shape. Try again.")
				return false
			}
			setItems(parsed.data.items ?? [])
			router.refresh()
			return true
		} catch {
			setError("Could not reach the server. Try again.")
			return false
		} finally {
			setSaving(false)
		}
	}

	async function save() {
		if (saving) return
		// Every field, because a reviewer prices the tier from this list: a line without a vendor, a link or a price is one they cannot check.
		const quantity = /^\d+$/.test(draft.quantity.trim()) ? Number(draft.quantity) : Number.NaN
		const unitCostUsd = parsePrice(draft.unitCostUsd)
		let link = draft.link.trim()
		if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`
		let linkOk = false
		try {
			linkOk = Boolean(link) && new URL(link).hostname.includes(".")
		} catch {
			linkOk = false
		}

		const bad = new Set<keyof Draft>()
		if (!draft.name.trim()) bad.add("name")
		if (!draft.purpose.trim()) bad.add("purpose")
		if (!(quantity >= 1)) bad.add("quantity")
		if (!(unitCostUsd > 0)) bad.add("unitCostUsd")
		if (!draft.vendor.trim()) bad.add("vendor")
		if (!linkOk) bad.add("link")
		setInvalid(bad)
		if (bad.size > 0) return setError(requiredMessage([...bad]))

		const body = {
			link,
			name: draft.name.trim(),
			purpose: draft.purpose.trim(),
			quantity,
			unitCostUsd,
			vendor: draft.vendor.trim(),
		}
		const done =
			editing === "new"
				? await send("POST", `/api/projects/${projectId}/bom`, body)
				: await send("PATCH", `/api/projects/${projectId}/bom/${editing}`, body)
		if (done)
			if (editing === "new") {
				// Adding is usually several parts in a row, so the form stays open and the cursor goes back to the first field.
				setDraft(EMPTY)
				nameInput.current?.focus()
			} else setEditing(null)
	}

	async function remove(line: BomLine) {
		if (saving) return
		const done = await send("DELETE", `/api/projects/${projectId}/bom/${line.id}`)
		if (done && editing === line.id) setEditing(null)
	}

	function changeDraft(key: keyof Draft, value: string) {
		setDraft(d => ({ ...d, [key]: value }))
		if (error) setError(null)
		if (invalid.has(key))
			setInvalid(s => {
				const next = new Set(s)
				next.delete(key)
				return next
			})
	}

	async function saveTaxShipping(value: number) {
		if (saving) return false
		if (value === taxShipping) return true
		setSaving(true)
		setError(null)
		try {
			const res = await fetch(`/api/projects/${projectId}/bom`, {
				body: JSON.stringify({ taxShippingUsd: value }),
				headers: { "content-type": "application/json" },
				method: "PATCH",
			})
			const parsed = BomPayloadSchema.safeParse(await res.json().catch(() => null))
			if (!res.ok) {
				setError((parsed.success ? parsed.data.error?.message : undefined) ?? "That did not save. Try again.")
				return false
			}
			if (!parsed.success) {
				setError("The server's answer was not in the expected shape. Try again.")
				return false
			}
			setTaxShipping(parsed.data.taxShippingUsd ?? 0)
			router.refresh()
			return true
		} catch {
			setError("Could not reach the server. Try again.")
			return false
		} finally {
			setSaving(false)
		}
	}

	return (
		<div>
			<p className="mb-4 text-[0.88rem] leading-snug text-navy-soft">
				Parts only. Don&apos;t list tools here. Enter all prices in US dollars (USD). Soldering irons, multimeters,
				cutters and the like are bought in the{" "}
				<Link className="underline decoration-dashed underline-offset-4 hover:text-navy" href="/shop">
					programme shop
				</Link>{" "}
				after your project is approved.
			</p>
			<div className="-mx-1 overflow-x-auto px-1">
				<table className="w-full min-w-120 text-left text-[0.86rem]">
					<thead>
						<tr className="border-b border-dashed border-line">
							{["Part", "Qty", "Unit", "Total", "Vendor"].map(h => (
								<th className="label px-3 py-2 text-navy-soft first:pl-0" key={h} scope="col">
									{h}
								</th>
							))}
							{!locked && (
								<th className="w-0 px-0 py-2" scope="col">
									<span className="sr-only">Actions</span>
								</th>
							)}
						</tr>
					</thead>
					<tbody>
						{items.length === 0 && (
							<tr className="border-b border-dashed border-line/60">
								<td className="hand py-4 text-[0.88rem] text-navy-soft" colSpan={locked ? 5 : 6}>
									no parts listed yet. Add what the build needs, with a real vendor and price.
								</td>
							</tr>
						)}
						{items.map(l => (
							<BomLineRow
								editing={editing === l.id}
								key={l.id}
								line={l}
								locked={locked}
								onEdit={open}
								onRemove={remove}
								saving={saving}
							/>
						))}
					</tbody>
					<tfoot>
						<ExtraRow
							disabled={saving}
							hint="for the whole order"
							label="Tax & shipping"
							locked={locked}
							onSave={saveTaxShipping}
							value={taxShipping}
						/>
					</tfoot>
				</table>
			</div>

			<div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
				<p className="text-[0.9rem] text-navy-soft">
					Total{" "}
					<span className={cx("text-[1.05rem] font-extrabold tabular-nums", over ? "text-coral-deep" : "text-navy")}>
						{formatUsd(total)}
					</span>{" "}
					of <span className="font-bold text-navy tabular-nums">${grantUsd}</span> tier {tier} funding
					{over && (
						<span className="hand block text-[0.84rem] text-coral-deep">
							{pastMargin
								? `${formatUsd(total - grantUsd)} over. You can still submit, but only $${grantUsd} of it will be funded and you'll cover the rest.`
								: `${formatUsd(total - grantUsd)} over. That is still within the $${BOM_MARGIN_USD} margin, so you can submit, but cut parts or ask for a higher tier if you can.`}
						</span>
					)}
				</p>
				{!locked && editing === null && (
					<div className="flex flex-wrap gap-2">
						<Button onClick={() => open("new")} size="sm" variant="outline">
							<IconPlus className="text-base" /> Add a part
						</Button>
						<Button disabled={saving || importOpen} onClick={() => setImportOpen(true)} size="sm" variant="ghost">
							<IconArrowDown className="text-base" /> Import from repo
						</Button>
					</div>
				)}
			</div>

			{locked && <p className="hand mt-2 text-[0.84rem] text-navy-soft">{locked}.</p>}

			{!locked && editing !== null && (
				<BomLineForm
					draft={draft}
					editing={editing}
					error={error}
					invalid={invalid}
					items={items}
					nameInput={nameInput}
					onCancel={() => setEditing(null)}
					onChange={changeDraft}
					onSave={() => void save()}
					saving={saving}
				/>
			)}
			{error && editing === null && (
				<p className="mt-2 text-[0.82rem] font-semibold text-coral-deep" role="alert">
					{error}
				</p>
			)}

			<BomImportDialog
				onClose={() => setImportOpen(false)}
				onImported={next => {
					setItems(next)
					router.refresh()
				}}
				open={importOpen}
				projectId={projectId}
			/>
		</div>
	)
}

/**
 * The order-wide line. The amount is edited in the row itself and saved when the field is left or Enter is pressed – there is nothing else about it to edit, so it never needs the form.
 */
function ExtraRow({
	label,
	hint,
	value,
	locked,
	disabled,
	onSave,
}: {
	label: string
	hint: string
	value: number
	locked: string | null
	disabled: boolean
	onSave(value: number): Promise<boolean>
}) {
	const id = useId()
	const [draft, setDraft] = useState(value ? value.toFixed(2) : "")
	const [invalid, setInvalid] = useState(false)

	async function commit() {
		const cleaned = draft.replaceAll("$", "").replaceAll(",", "").trim()
		const n = cleaned === "" ? 0 : Number(cleaned)
		if (!Number.isFinite(n) || n < 0) {
			setInvalid(true)
			return
		}
		setInvalid(false)
		const cents = round2(n)
		if (await onSave(cents)) setDraft(cents ? cents.toFixed(2) : "")
	}

	return (
		<tr className="border-b border-dashed border-line/60 align-middle last:border-0">
			<td className="py-2.5 pr-3">
				<label className="block font-semibold text-navy" htmlFor={id}>
					{label}
				</label>
				<span className="block text-[0.8rem] leading-snug text-navy-soft">{hint}</span>
			</td>
			<td className="px-3 py-2.5 text-navy-soft">-</td>
			<td className="px-3 py-2.5 text-navy-soft">-</td>
			<td className="px-3 py-1.5 font-semibold text-navy tabular-nums" colSpan={locked ? 2 : 3}>
				{locked ? (
					formatUsd(value)
				) : (
					<span className="inline-flex items-center gap-1">
						<span aria-hidden="true">$</span>
						<input
							aria-describedby={invalid ? `${id}-error` : undefined}
							aria-invalid={invalid || undefined}
							// Its own look rather than inputClass: a white field on the white panel reads as a printed number, not one you can change.
							className={cx(
								"block w-24 rounded-lg border-2 border-field bg-black/[.03] px-2.5 py-1.5 text-[0.86rem] text-navy tabular-nums outline-none placeholder:text-navy-faint",
								"transition-colors hover:border-navy-soft focus:border-violet focus:bg-white",
								invalid && "border-coral-deep! text-coral-deep",
							)}
							disabled={disabled}
							id={id}
							inputMode="decimal"
							onBlur={() => commit()}
							onChange={e => {
								setDraft(e.target.value.replaceAll("$", ""))
								if (invalid) setInvalid(false)
							}}
							onKeyDown={e => {
								if (e.key === "Enter") {
									e.preventDefault()
									e.currentTarget.blur()
								}
							}}
							placeholder="0.00"
							value={draft}
						/>
						{invalid && (
							<p className="hand mt-1 text-[0.76rem] text-coral-deep" id={`${id}-error`} role="alert">
								Enter 0 or more, e.g. 12.50.
							</p>
						)}
					</span>
				)}
			</td>
		</tr>
	)
}
