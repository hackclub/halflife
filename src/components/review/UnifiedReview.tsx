"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { type DragEvent, type ReactNode, useState } from "react"
import { saveUnified } from "@/components/review/api"
import { FormErrors, PageHead, Paper, StatusTag, TierTag } from "@/components/review/ui"
import { HardLink } from "@/components/site/HardLink"
import type { UnifiedField, UnifiedReviewDetail } from "@/lib/review-platform/types"

interface Layout {
	key: string
	rows?: number
	span?: number
}

/** The columns the unified database requires, laid out as Fabricate's T2 screen lays them. */
const REQUIRED: readonly Layout[] = Object.freeze([
	{ key: "codeUrl", span: 2 },
	{ key: "playableUrl", span: 2 },
	{ key: "firstName" },
	{ key: "lastName" },
	{ key: "email" },
	{ key: "birthday" },
	{ key: "addressLine1", span: 2 },
	{ key: "addressLine2", span: 2 },
	{ key: "city" },
	{ key: "state" },
	{ key: "zip" },
	{ key: "country" },
	{ key: "overrideHoursSpent" },
	{ key: "description", rows: 2, span: 3 },
	{ key: "overrideHoursSpentJustification", rows: 12, span: 4 },
])

const isVideoUrl = (url: string): boolean => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((value, i) => value === b[i])

function Thumb({ url }: { url: string }) {
	return isVideoUrl(url) ? (
		<video muted playsInline preload="metadata" src={url} />
	) : (
		<img alt="" draggable={false} src={url} />
	)
}

type Drag = { from: "picked"; index: number } | { from: "option"; url: string }

/**
 * Fabricate's screenshot picker: the chosen screenshots in order, the first being the cover, reordered by dragging or the arrows, and the rest of the project's images to pick from.
 *
 * Fabricate's upload tile is left out: Half Life's uploads are scoped to a maker's own journal, so a T2 screenshot is one the maker already put on the project.
 */
function ScreenshotPicker({
	generated,
	max,
	onChange,
	options,
	value,
}: {
	generated: string[]
	max: number
	onChange(urls: string[]): void
	options: string[]
	value: string[]
}) {
	const [drag, setDrag] = useState<Drag | null>(null)
	const [over, setOver] = useState<number | null>(null)
	const [open, setOpen] = useState(false)
	const pool = options.filter(url => !value.includes(url))
	const full = value.length >= max

	function move(from: number, to: number): void {
		if (to < 0 || to >= value.length || from === to) return
		const next = [...value]
		const [url] = next.splice(from, 1)
		if (url !== undefined) next.splice(to, 0, url)
		onChange(next)
	}

	function place(url: string, at: number): void {
		const next = [...value]
		if (full) next[Math.min(at, next.length - 1)] = url
		else next.splice(at, 0, url)
		onChange(next)
	}

	function endDrag(): void {
		setDrag(null)
		setOver(null)
	}

	function drop(at: number): void {
		if (!drag) return
		if (drag.from === "picked") move(drag.index, Math.min(at, value.length - 1))
		else place(drag.url, at)
		endDrag()
	}

	const slot = (i: number) => ({
		onDragLeave: () => setOver(current => (current === i ? null : current)),
		onDragOver: (e: DragEvent) => {
			if (!drag) return
			e.preventDefault()
			setOver(i)
		},
		onDrop: (e: DragEvent) => {
			e.preventDefault()
			drop(i)
		},
	})

	return (
		<div className="shot-picker">
			<ol className="shot-picker__picked">
				{value.map((url, i) => (
					<li
						className={["shot-picker__slot", over === i ? "is-over" : ""].filter(Boolean).join(" ")}
						draggable
						key={url}
						onDragEnd={endDrag}
						onDragStart={() => setDrag({ from: "picked", index: i })}
						{...slot(i)}
					>
						<a className="shot-picker__image" href={url} rel="noopener noreferrer" target="_blank">
							<Thumb url={url} />
						</a>
						<div className="shot-picker__bar">
							<span>{i === 0 ? "Cover" : i + 1}</span>
							<button aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, i - 1)} type="button">
								←
							</button>
							<button
								aria-label="Move later"
								disabled={i === value.length - 1}
								onClick={() => move(i, i + 1)}
								type="button"
							>
								→
							</button>
							<button aria-label="Remove" onClick={() => onChange(value.filter(other => other !== url))} type="button">
								×
							</button>
						</div>
					</li>
				))}
				{full ? null : (
					<li
						className={["shot-picker__slot shot-picker__slot--empty", over === value.length ? "is-over" : ""]
							.filter(Boolean)
							.join(" ")}
						{...slot(value.length)}
					>
						<button onClick={() => setOpen(true)} type="button">
							{value.length === 0 ? "Pick a screenshot" : `Add one (${value.length}/${max})`}
						</button>
					</li>
				)}
			</ol>
			<details className="shot-picker__more" onToggle={e => setOpen(e.currentTarget.open)} open={open}>
				<summary>
					Change screenshots ({pool.length} more)
					{sameList(value, generated) ? null : (
						<>
							{" · "}
							<button
								className="unified__reset"
								onClick={e => {
									e.preventDefault()
									onChange(generated)
								}}
								type="button"
							>
								reset to generated
							</button>
						</>
					)}
				</summary>
				<p className="field__hint">Drag to reorder, or drop an image onto a slot to swap it in. Click one to add it.</p>
				<div className="shot-picker__pool">
					{pool.map(url => (
						<button
							className="shot-picker__option"
							draggable
							key={url}
							onClick={() => {
								if (!full) onChange([...value, url])
							}}
							onDragEnd={endDrag}
							onDragStart={() => setDrag({ from: "option", url })}
							title={full ? "Drag onto a slot to swap it in" : "Add"}
							type="button"
						>
							<Thumb url={url} />
						</button>
					))}
				</div>
			</details>
		</div>
	)
}

/** A column's label as the screen shows it: the base's name, without the `Optional - ` prefix that only matters to the pipeline. */
const labelOf = (field: UnifiedField): string => field.label.replace(/^Optional - /, "")

/**
 * T2: a website approval's Airtable fields, checked and corrected by an admin before it goes to the unified database. Fabricate's `Admin/UnifiedReviews/Show`, on Half Life's row.
 *
 * Every field starts at what Half Life writes on its own, or at an override an admin saved earlier; "reset" puts the generated value back. Saving writes the fields to the row; approving writes them and ticks `Automation - Submit to Unified YSWS`, then moves on to the next approval waiting.
 *
 * `check` is the unified database's duplicate lookup, streamed in by the page so a slow base does not hold up the form.
 */
export function UnifiedReview({ check, detail }: { check: ReactNode; detail: UnifiedReviewDetail }) {
	return <UnifiedReviewInner check={check} detail={detail} key={detail.id} />
}

function UnifiedReviewInner({ check, detail }: { check: ReactNode; detail: UnifiedReviewDetail }) {
	const router = useRouter()
	const initial = Object.fromEntries(detail.fields.map(column => [column.key, column.value]))
	const [values, setValues] = useState<{ [_: string]: string }>(initial)
	const [screenshots, setScreenshots] = useState<string[]>(detail.screenshots)
	const [busy, setBusy] = useState(false)
	const [errors, setErrors] = useState<string[]>([])
	const [saved, setSaved] = useState(false)

	const byKey = new Map(detail.fields.map(column => [column.key, column]))
	const laidOut = new Set(REQUIRED.map(layout => layout.key))
	const other: Layout[] = detail.fields.filter(column => !laidOut.has(column.key)).map(column => ({ key: column.key }))
	const currentValue = (key: string): string => values[key] ?? ""
	const edited = (key: string): boolean => currentValue(key).trim() !== (byKey.get(key)?.generated ?? "").trim()
	const otherEdited = other.filter(layout => edited(layout.key)).length
	const dirty =
		detail.fields.some(column => currentValue(column.key) !== column.value)
		|| !sameList(screenshots, detail.screenshots)
	const sent = detail.sent !== null

	function setField(key: string, value: string): void {
		setValues(current => ({ ...current, [key]: value }))
		setSaved(false)
	}

	async function submit(approve: boolean): Promise<void> {
		setErrors([])
		setBusy(true)
		try {
			await saveUnified(detail.id, { approve, fields: values, screenshots })
			if (approve) {
				router.push(detail.nextId ? `/reviews/unified/${detail.nextId}` : "/reviews/unified")
				router.refresh()
				return
			}
			setSaved(true)
			router.refresh()
		} catch (err) {
			setErrors([err instanceof Error ? err.message : "Couldn't save to Airtable"])
		} finally {
			setBusy(false)
		}
	}

	function fieldInput({ key, rows, span }: Layout) {
		const def = byKey.get(key)
		if (!def) return null
		const id = `unified-${key}`
		return (
			<div className={["field", span ? `unified__span-${span}` : ""].filter(Boolean).join(" ")} key={key}>
				<div className="unified__label">
					<label className="field__label" htmlFor={id}>
						{labelOf(def)}
					</label>
					{edited(key) ? (
						<button className="unified__reset" onClick={() => setField(key, def.generated)} type="button">
							reset
						</button>
					) : null}
				</div>
				{rows ? (
					<textarea
						className="field__textarea"
						id={id}
						onChange={e => setField(key, e.target.value)}
						rows={rows}
						value={currentValue(key)}
					/>
				) : (
					<input
						className="field__input"
						id={id}
						inputMode={key === "overrideHoursSpent" ? "decimal" : undefined}
						onChange={e => setField(key, e.target.value)}
						value={currentValue(key)}
					/>
				)}
			</div>
		)
	}

	return (
		<>
			<PageHead
				actions={
					<>
						<HardLink className="btn btn--outline" href={`/projects/${detail.projectId}`}>
							Project
						</HardLink>
						{detail.nextId ? (
							<Link className="btn btn--outline" href={`/reviews/unified/${detail.nextId}`}>
								Skip
							</Link>
						) : null}
					</>
				}
				className="page-head--pinned page-head--compact"
				eyebrow={
					<>
						<Link href="/reviews">←</Link> ·{" "}
						{detail.position === null ? "T2 review" : `T2 review ${detail.position} of ${detail.total}`} ·{" "}
						<Link href={`/reviews/${detail.submissionId}`}>Review</Link> · {detail.makerName} · approved by{" "}
						{detail.reviewerName} on {detail.reviewedAt} · {detail.claimedHours}h claimed{" "}
						<StatusTag status={detail.kind} />
						{detail.kind === "design" ? (
							<>
								{" "}
								<TierTag tier={detail.tier} />
							</>
						) : null}
					</>
				}
				title={detail.projectName}
			/>
			{detail.kind === "build" ? (
				<Paper variant="flag">
					<p className="field__hint">
						Build hand-in.{" "}
						{detail.designSentAt
							? `The design went to Unified on ${detail.designSentAt}.`
							: "The design hasn't been sent to Unified yet, so check it first."}{" "}
						The Playable URL is the build reel.
					</p>
				</Paper>
			) : null}
			{sent ? (
				<Paper variant="flag">
					<p className="field__hint">
						Sent to Unified on {detail.sent?.at}
						{detail.sent?.by ? ` by ${detail.sent.by}` : " (ticked in Airtable, not from T2)"}. Saving still writes the
						fields to the row.
					</p>
				</Paper>
			) : null}
			{detail.airtableProblem ? (
				<p className="field__error" role="alert">
					{detail.airtableProblem}
				</p>
			) : null}
			<form
				className="unified"
				onSubmit={e => {
					e.preventDefault()
					void submit(true)
				}}
			>
				<Paper variant="tight">
					<div className="unified__fields">{REQUIRED.map(fieldInput)}</div>
					{other.length > 0 ? (
						<details className="unified__more">
							<summary>Other Unified fields{otherEdited > 0 ? ` (${otherEdited} edited)` : ""}</summary>
							<div className="unified__fields">{other.map(fieldInput)}</div>
						</details>
					) : null}
				</Paper>
				<Paper variant="tight">
					<ScreenshotPicker
						generated={detail.generatedScreenshots}
						max={detail.maxScreenshots}
						onChange={urls => {
							setScreenshots(urls)
							setSaved(false)
						}}
						options={detail.screenshotOptions}
						value={screenshots}
					/>
					{check}
					<p className="field__hint">
						Hours here change what the unified database records, not the coins Half Life paid on approval.
					</p>
					<FormErrors errors={errors} />
					<div className="form__actions">
						<button
							className="btn btn--ink btn--approve"
							disabled={busy || sent || detail.airtableProblem !== null || screenshots.length === 0}
							type="submit"
						>
							Approve T2 &amp; submit to Unified
						</button>
						<button
							className="btn btn--outline"
							disabled={busy || !dirty || detail.airtableProblem !== null}
							onClick={() => void submit(false)}
							type="button"
						>
							Save
						</button>
						{saved && !dirty ? <span className="field__hint">Saved to Airtable.</span> : null}
					</div>
				</Paper>
			</form>
		</>
	)
}
