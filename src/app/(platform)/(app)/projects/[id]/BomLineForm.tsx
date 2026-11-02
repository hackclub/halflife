"use client"

import { type RefObject, useId } from "react"
import { Button, inputClass } from "@/components/platform/ui"
import type { BomLine } from "@/lib/bom-schema"
import { cx } from "@/lib/cx"
import type { Draft } from "./bom-editor-model"

/** The add/edit form under the table, so the table itself never grows inputs. */
export function BomLineForm({
	draft,
	editing,
	error,
	invalid,
	items,
	nameInput,
	onCancel,
	onChange,
	onSave,
	saving,
}: {
	draft: Draft
	editing: string
	error: string | null
	invalid: Set<keyof Draft>
	items: BomLine[]
	nameInput: RefObject<HTMLInputElement | null>
	onCancel(): void
	onChange(key: keyof Draft, value: string): void
	onSave(): void
	saving: boolean
}) {
	const id = useId()
	const field = (key: keyof Draft) => ({
		"aria-invalid": invalid.has(key) || undefined,
		// A red border rather than a ring. `inputClass` carries its own border now, so the invalid colour is `!`: two border colours in one layer are settled by whichever Tailwind happens to emit last.
		className: cx(inputClass, "py-2 text-[0.88rem]", invalid.has(key) && "border-coral-deep! bg-coral/5"),
		id: `${id}-${key}`,
		onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
			// Strip a pasted `$` straight off the price field, so what the maker sees is what saves.
			onChange(key, key === "unitCostUsd" ? e.target.value.replaceAll("$", "") : e.target.value)
		},
		required: true,
		value: draft[key],
	})

	return (
		<form
			className="mt-4 grid gap-3 rounded-2xl bg-black/[.03] p-4"
			noValidate
			onKeyDown={e => {
				if (e.key === "Escape") onCancel()
			}}
			onSubmit={e => {
				e.preventDefault()
				onSave()
			}}
		>
			<p className="text-[0.9rem] font-extrabold text-navy">
				{editing === "new" ? "Add a part" : `Edit ${items.find(l => l.id === editing)?.name ?? "part"}`}
			</p>
			<p className="-mt-2 text-[0.8rem] text-navy-soft">
				You can lump all of your passive components together (LEDs, resistors, diodes, transistors, etc) into one BOM
				entry. Prices are in US dollars (USD); the minimum cost for an item is $0.01.
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
				<Button disabled={saving} onClick={onCancel} size="sm" type="button" variant="ghost">
					{editing === "new" ? "Done" : "Cancel"}
				</Button>
			</div>
		</form>
	)
}
