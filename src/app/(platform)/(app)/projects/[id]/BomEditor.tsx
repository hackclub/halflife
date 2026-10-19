"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId, useRef, useState } from "react"
import { IconArrowDown, IconPencil, IconPlus, IconX } from "@/components/platform/icons"
import { Modal, ModalTitle } from "@/components/platform/modals/Modal"
import { Button, inputClass } from "@/components/platform/ui"
import type { BomLine } from "@/lib/bom"
import { BOM_MARGIN_USD, bomTotalUsd } from "@/lib/bom-policy"
import { cx } from "@/lib/cx"

const usd = (n: number) => `$${n.toFixed(2)}`

/** What the import route reports after reading the repo's CSV. */
interface ImportPreview {
	/** Lines already on the page, so the copy can offer add vs replace. */
	existing: number
	lines: {
		name: string
		purpose: string | null
		quantity: number
		unitCostUsd: number
		vendor: string | null
		link: string | null
	}[]
	path: string
	skipped: { row: number; name: string; reason: string }[]
}

interface Draft {
	link: string
	name: string
	purpose: string
	quantity: string
	unitCostUsd: string
	vendor: string
}

const FIELD_NAMES: Record<keyof Draft, string> = {
	link: "Link",
	name: "Part",
	purpose: "What it's for",
	quantity: "Qty",
	unitCostUsd: "Unit $",
	vendor: "Vendor",
}

/** "Fill out the required fields", naming the ones that are missing. */
function requiredMessage(fields: (keyof Draft)[]) {
	return `Fill out the required fields: ${fields.map(k => FIELD_NAMES[k]).join(", ")}.`
}

const EMPTY: Draft = { link: "", name: "", purpose: "", quantity: "1", unitCostUsd: "", vendor: "" }

function draftOf(line: BomLine): Draft {
	return {
		link: line.link ?? "",
		name: line.name,
		purpose: line.purpose ?? "",
		quantity: String(line.quantity),
		unitCostUsd: line.unitCostUsd ? String(line.unitCostUsd) : "",
		vendor: line.vendor ?? "",
	}
}

/**
 * The parts list, kept here rather than typed out at submission time.
 *
 * One table, one form. The form sits under the table and serves both adding and editing, so the table itself never grows inputs and stays readable at phone width with a horizontal scroll. The total is read against the tier's funding because that is the question the list answers: does this project fit the money it is asking for.
 *
 * Tax and shipping close the table as one fixed line for the whole order. It has an amount and nothing else – no edit form and no remove – because every order has it, even at zero.
 */
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
	const id = useId()
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
	const [importLoading, setImportLoading] = useState(false)
	const [importing, setImporting] = useState(false)
	const [importError, setImportError] = useState<string | null>(null)
	const [preview, setPreview] = useState<ImportPreview | null>(null)

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
			const payload = await res.json().catch(() => null)
			if (!res.ok) {
				// The server's field check says which fields, not just "Invalid request": outline those and say it the way the form's own check does. This catches anything the form let through, like a tab still running an older copy of it.
				const fields = Object.keys(payload?.error?.details?.properties ?? {}).filter(
					(k): k is keyof Draft => k in FIELD_NAMES,
				)
				if (payload?.error?.code === "VALIDATION_FAILED" && fields.length > 0) {
					setInvalid(new Set(fields))
					setError(requiredMessage(fields))
				} else setError(payload?.error?.message ?? "That did not save. Try again.")

				return false
			}
			setItems(payload.items as BomLine[])
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
		const unitCostUsd = draft.unitCostUsd.trim() ? Number(draft.unitCostUsd) : Number.NaN
		let link = draft.link.trim()
		if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`
		let linkOk = false
		try {
			linkOk = !!link && new URL(link).hostname.includes(".")
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

	/** Open the dialog and read the repo, so the preview is ready when it shows. */
	async function openImport() {
		setImportOpen(true)
		setPreview(null)
		setImportError(null)
		setImportLoading(true)
		try {
			const res = await fetch(`/api/projects/${projectId}/bom/import`, {
				body: JSON.stringify({ apply: false }),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
			const payload = await res.json().catch(() => null)
			if (!res.ok) {
				setImportError(payload?.error?.message ?? "Could not read the repo. Try again.")
				return
			}
			setPreview(payload as ImportPreview)
		} catch {
			setImportError("Could not reach the server. Try again.")
		} finally {
			setImportLoading(false)
		}
	}

	async function applyImport(replace: boolean) {
		setImporting(true)
		setImportError(null)
		try {
			const res = await fetch(`/api/projects/${projectId}/bom/import`, {
				body: JSON.stringify({ apply: true, replace }),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
			const payload = await res.json().catch(() => null)
			if (!res.ok) {
				setImportError(payload?.error?.message ?? "That did not save. Try again.")
				return
			}
			setItems(payload.items as BomLine[])
			setImportOpen(false)
			router.refresh()
		} catch {
			setImportError("Could not reach the server. Try again.")
		} finally {
			setImporting(false)
		}
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
			const payload = await res.json().catch(() => null)
			if (!res.ok) {
				setError(payload?.error?.message ?? "That did not save. Try again.")
				return false
			}
			setTaxShipping(payload.taxShippingUsd)
			router.refresh()
			return true
		} catch {
			setError("Could not reach the server. Try again.")
			return false
		} finally {
			setSaving(false)
		}
	}

	const field = (key: keyof Draft) => ({
		"aria-invalid": invalid.has(key) || undefined,
		// A red border rather than a ring. `inputClass` carries its own border now, so the invalid colour is `!`: two border colours in one layer are settled by whichever Tailwind happens to emit last.
		className: cx(inputClass, "py-2 text-[0.88rem]", invalid.has(key) && "border-coral-deep! bg-coral/5"),
		id: `${id}-${key}`,
		onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
			setDraft(d => ({ ...d, [key]: e.target.value }))
			if (error) setError(null)
			if (invalid.has(key))
				setInvalid(s => {
					const next = new Set(s)
					next.delete(key)
					return next
				})
		},
		required: true,
		value: draft[key],
	})

	return (
		<div>
			<p className="mb-4 text-[0.88rem] leading-snug text-navy-soft">
				Parts only – don&apos;t list tools here. Enter all prices in US dollars (USD). Soldering irons, multimeters,
				cutters and the like are bought in the{" "}
				<Link className="underline decoration-dashed underline-offset-4 hover:text-navy" href="/shop">
					programme shop
				</Link>{" "}
				after your project is approved.
			</p>
			<div className="-mx-1 overflow-x-auto px-1">
				<table className="w-full min-w-[480px] text-left text-[0.86rem]">
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
							<tr
								className={cx(
									"border-b border-dashed border-line/60 align-top",
									editing === l.id && "bg-violet-pale/50",
								)}
								key={l.id}
							>
								<td className="py-2.5 pr-3">
									<span className="block font-semibold [overflow-wrap:anywhere] text-navy">{l.name}</span>
									{l.purpose && <span className="block text-[0.8rem] leading-snug text-navy-soft">{l.purpose}</span>}
								</td>
								<td className="px-3 py-2.5 tabular-nums">{l.quantity}</td>
								<td className="px-3 py-2.5 tabular-nums">{usd(l.unitCostUsd)}</td>
								<td className="px-3 py-2.5 font-semibold text-navy tabular-nums">{usd(l.quantity * l.unitCostUsd)}</td>
								<td className="hand px-3 py-2.5 text-navy-soft">
									{l.link ? (
										<a
											className="underline decoration-line-strong underline-offset-4 hover:text-navy hover:decoration-violet"
											href={l.link}
											rel="noopener noreferrer"
											target="_blank"
										>
											{l.vendor || "link"}
										</a>
									) : (
										l.vendor || "—"
									)}
								</td>
								{!locked && (
									<td className="py-1.5 pl-2 whitespace-nowrap">
										<button
											aria-label={`Edit ${l.name}`}
											className="inline-grid size-8 place-items-center rounded-full text-navy-soft transition-colors hover:bg-black/5 hover:text-navy"
											disabled={saving}
											onClick={() => open(l)}
											type="button"
										>
											<IconPencil className="text-sm" />
										</button>
										<button
											aria-label={`Remove ${l.name}`}
											className="inline-grid size-8 place-items-center rounded-full text-navy-soft transition-colors hover:bg-coral/10 hover:text-coral-deep"
											disabled={saving}
											onClick={() => remove(l)}
											type="button"
										>
											<IconX className="text-sm" />
										</button>
									</td>
								)}
							</tr>
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
						{usd(total)}
					</span>{" "}
					of <span className="font-bold text-navy tabular-nums">${grantUsd}</span> tier {tier} funding
					{over && (
						<span className="hand block text-[0.84rem] text-coral-deep">
							{pastMargin
								? `${usd(total - grantUsd)} over – you can still submit, but only $${grantUsd} of it will be funded and you'll cover the rest.`
								: `${usd(total - grantUsd)} over – still within the $${BOM_MARGIN_USD} margin, so you can submit, but cut parts or ask for a higher tier if you can.`}
						</span>
					)}
				</p>
				{!locked && editing === null && (
					<div className="flex flex-wrap gap-2">
						<Button onClick={() => open("new")} size="sm" variant="outline">
							<IconPlus className="text-base" /> Add a part
						</Button>
						<Button disabled={saving || importLoading} onClick={() => openImport()} size="sm" variant="ghost">
							<IconArrowDown className="text-base" /> Import from repo
						</Button>
					</div>
				)}
			</div>

			{locked && <p className="hand mt-2 text-[0.84rem] text-navy-soft">{locked}.</p>}

			{!locked && editing !== null && (
				<form
					className="mt-4 grid gap-3 rounded-2xl bg-black/[.03] p-4"
					noValidate
					onKeyDown={e => {
						if (e.key === "Escape") setEditing(null)
					}}
					onSubmit={e => {
						e.preventDefault()
						save()
					}}
				>
					<p className="text-[0.9rem] font-extrabold text-navy">
						{editing === "new" ? "Add a part" : `Edit ${items.find(l => l.id === editing)?.name ?? "part"}`}
					</p>
					<p className="-mt-2 text-[0.8rem] text-navy-soft">
						You can lump all of your passive components together (LEDs, resistors, diodes, transistors, etc) into one
						BOM entry. Prices are in US dollars (USD); the minimum cost for an item is $0.01.
					</p>
					<div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
						<label className="grid gap-1">
							<span className="label text-violet-deep">Part</span>
							<input {...field("name")} maxLength={120} placeholder="ESP32-C3 SuperMini" ref={nameInput} />
						</label>
						<label className="grid gap-1">
							<span className="label text-violet-deep">What it&apos;s for</span>
							<input {...field("purpose")} maxLength={200} placeholder="Wi-Fi and the main loop" />
						</label>
					</div>
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-[5rem_7rem_minmax(0,1fr)_minmax(0,1.5fr)]">
						<label className="grid gap-1">
							<span className="label text-violet-deep">Qty</span>
							<input {...field("quantity")} inputMode="numeric" />
						</label>
						<label className="grid gap-1">
							<span className="label text-violet-deep">Unit $</span>
							<input {...field("unitCostUsd")} inputMode="decimal" placeholder="0.00" />
						</label>
						<label className="grid gap-1">
							<span className="label text-violet-deep">Vendor</span>
							<input {...field("vendor")} maxLength={80} placeholder="LCSC" />
						</label>
						<label className="grid gap-1">
							<span className="label text-violet-deep">Link</span>
							<input {...field("link")} inputMode="url" placeholder="lcsc.com/product-detail/…" spellCheck={false} />
						</label>
					</div>
					{error && (
						<p className="text-[0.82rem] font-semibold text-coral-deep" role="alert">
							{error}
						</p>
					)}
					<div className="flex flex-wrap gap-2">
						<Button disabled={saving} size="sm" type="submit" variant="solid">
							{saving ? "Saving…" : editing === "new" ? "Add part" : "Save"}
						</Button>
						<Button disabled={saving} onClick={() => setEditing(null)} size="sm" type="button" variant="ghost">
							{editing === "new" ? "Done" : "Cancel"}
						</Button>
					</div>
				</form>
			)}
			{error && editing === null && (
				<p className="mt-2 text-[0.82rem] font-semibold text-coral-deep" role="alert">
					{error}
				</p>
			)}

			<Modal
				dismissible={!importing}
				eyebrow="Bill of materials"
				footer={
					preview && preview.lines.length > 0 ? (
						<>
							<Button disabled={importing} onClick={() => setImportOpen(false)} size="sm" variant="ghost">
								Cancel
							</Button>
							{preview.existing > 0 && (
								<Button disabled={importing} onClick={() => applyImport(false)} size="sm" variant="outline">
									{importing ? "Adding…" : `Add ${preview.lines.length} to my list`}
								</Button>
							)}
							<Button disabled={importing} onClick={() => applyImport(true)} size="sm" variant="solid">
								{importing
									? "Importing…"
									: preview.existing > 0
										? `Replace with ${preview.lines.length}`
										: `Import ${preview.lines.length} ${preview.lines.length === 1 ? "part" : "parts"}`}
							</Button>
						</>
					) : (
						<Button disabled={importing} onClick={() => setImportOpen(false)} size="sm" variant="ghost">
							Close
						</Button>
					)
				}
				onClose={() => setImportOpen(false)}
				open={importOpen}
				size="lg"
			>
				<ModalTitle sub="Read from the bom*.csv in your project's repo, so parts you have listed once are not typed in again.">
					Import parts from your repo
				</ModalTitle>

				{importLoading ? (
					<p aria-live="polite" className="hand text-[0.9rem] text-navy-soft">
						reading your repo…
					</p>
				) : importError ? (
					<p className="text-[0.88rem] font-semibold text-coral-deep" role="alert">
						{importError}
					</p>
				) : preview ? (
					<div className="grid gap-4">
						{preview.lines.length === 0 ? (
							<p className="text-[0.9rem] leading-relaxed text-navy-soft">
								No importable parts were found in <code className="hand text-navy">{preview.path}</code>.
							</p>
						) : (
							<>
								<p className="text-[0.9rem] leading-relaxed text-navy-soft">
									Read {preview.lines.length} {preview.lines.length === 1 ? "part" : "parts"} from{" "}
									<code className="hand text-navy">{preview.path}</code>. What the file did not say is left blank – open
									each line and add a purpose, and a vendor and price a reviewer can check.
								</p>
								{preview.existing > 0 && (
									<p className="hand text-[0.84rem] text-navy-soft">
										your list already has {preview.existing}. Adding keeps them; replacing clears them first.
									</p>
								)}
								<div className="-mx-1 max-h-[42vh] overflow-auto px-1">
									<table className="w-full min-w-[440px] text-left text-[0.85rem]">
										<thead>
											<tr className="border-b border-dashed border-line">
												{["Part", "Qty", "Unit", "Vendor"].map(h => (
													<th className="label px-3 py-2 text-navy-soft first:pl-0" key={h} scope="col">
														{h}
													</th>
												))}
											</tr>
										</thead>
										<tbody>
											{preview.lines.map((l, i) => (
												<tr className="border-b border-dashed border-line/60 align-top" key={`${l.name}-${i}`}>
													<td className="py-2 pr-3">
														<span className="block font-semibold [overflow-wrap:anywhere] text-navy">{l.name}</span>
													</td>
													<td className="px-3 py-2 tabular-nums">{l.quantity}</td>
													<td className="px-3 py-2 tabular-nums">
														{l.unitCostUsd > 0 ? usd(l.unitCostUsd) : <span className="text-coral-deep">no price</span>}
													</td>
													<td className="hand px-3 py-2 text-navy-soft">{l.vendor || "—"}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</>
						)}

						{preview.skipped.length > 0 && (
							<div className="rounded-xl bg-black/[.03] px-3.5 py-3">
								<p className="label text-violet-deep">Skipped {preview.skipped.length}</p>
								<ul className="mt-1.5 grid gap-1">
									{preview.skipped.map(s => (
										<li className="text-[0.82rem] leading-snug text-navy-soft" key={s.row}>
											<span className="font-semibold text-navy">{s.name || `line ${s.row}`}</span> – {s.reason}
										</li>
									))}
								</ul>
							</div>
						)}
					</div>
				) : null}
			</Modal>
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
		const n = draft.trim() === "" ? 0 : Number(draft)
		if (!Number.isFinite(n) || n < 0) {
			setInvalid(true)
			return
		}
		setInvalid(false)
		const cents = Math.round(n * 100) / 100
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
			<td className="px-3 py-2.5 text-navy-soft">–</td>
			<td className="px-3 py-2.5 text-navy-soft">–</td>
			<td className="px-3 py-1.5 font-semibold text-navy tabular-nums" colSpan={locked ? 2 : 3}>
				{locked ? (
					usd(value)
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
								setDraft(e.target.value)
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
