"use client"

import { useId, useState } from "react"
import { IconPencil } from "@/components/platform/icons"
import { Button, Field, inputClass } from "@/components/platform/ui"
import { cx } from "@/lib/cx"
import { displayRepo, normalizeRepo } from "@/lib/repo"
import { README_GUIDE_URL } from "@/lib/routes"
import { useStore } from "@/lib/store"
import type { Project } from "@/lib/types"

/**
 * The repo field in a project-creation form. Optional on purpose: a first board often has no repo until it has a schematic worth pushing, and the link can be added from the project page whenever it exists.
 *
 * Checked on blur rather than per keystroke, so half a URL is not told off
 * while it is still being typed. The form reads the same check back through
 * `repoIsValid` to hold its own submit button.
 */
export function RepoInput({ value, onChange, id }: { value: string; onChange(value: string): void; id: string }) {
	const [touched, setTouched] = useState(false)
	const { error } = normalizeRepo(value)
	return (
		<Field
			hint="Where the code, schematics and CAD live. Optional, and you can add or change it later on the project page."
			id={id}
			label="Repo link"
		>
			<input
				aria-describedby={touched && error ? `${id}-err` : undefined}
				aria-invalid={(touched && !!error) || undefined}
				autoComplete="url"
				className={inputClass}
				id={id}
				inputMode="url"
				onBlur={() => setTouched(true)}
				onChange={e => onChange(e.target.value)}
				placeholder="github.com/you/your-project"
				spellCheck={false}
				value={value}
			/>
			{touched && error && (
				<p className="mt-1.5 text-[0.8rem] font-semibold text-coral-deep" id={`${id}-err`}>
					{error}
				</p>
			)}
			{/* The repo is asked for before there is anything in it, so this is the first and often only moment to say what the repo has to end up holding. The README is the part a reviewer opens first and the part nothing else on this form explains. */}
			<p className="mt-1.5 text-[0.78rem] leading-snug text-navy-soft">
				Your repo needs a README that says what the project is, how it works, and shows at least two photos of it – at
				least 200 characters of text, once images are removed –{" "}
				<a
					className="font-semibold text-sky-ink underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
					href={README_GUIDE_URL}
					rel="noopener noreferrer"
					target="_blank"
				>
					see how to write one
				</a>
				.
			</p>
		</Field>
	)
}

/** Whether a creation form may submit with this in its repo field. */
export function repoIsValid(value: string) {
	return normalizeRepo(value).error === null
}

/**
 * A project's repo, read or edited in place.
 *
 * One line when it is set – the link itself, shortened to what anyone reads – and one quiet prompt when it is not, so an empty repo does not take up the room of a form on every card. Editing swaps the line for an input and two buttons without moving what is around it much, and the server's refusal (a phase in review is locked) is said right there rather than lost.
 */
export function RepoEditor({ project, className }: { project: Project; className?: string }) {
	const { setProjectRepo } = useStore()
	const id = useId()
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState(project.githubRepo ?? "")
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const current = project.githubRepo ?? null

	async function save() {
		const { url, error: invalid } = normalizeRepo(draft)
		if (invalid) {
			setError(invalid)
			return
		}
		if (url === current) {
			setEditing(false)
			return
		}
		setSaving(true)
		setError(null)
		const refused = await setProjectRepo(project.id, url)
		setSaving(false)
		if (refused) setError(refused)
		else setEditing(false)
	}

	if (!editing) {
		return (
			<div className={cx("flex min-w-0 items-center gap-2", className)}>
				{current ? (
					<>
						<a
							className="min-w-0 truncate text-[0.85rem] font-semibold text-navy underline decoration-line-strong decoration-2 underline-offset-4 transition-colors hover:decoration-violet"
							href={current}
							rel="noopener noreferrer"
							target="_blank"
							title={current}
						>
							{displayRepo(current)}
						</a>
						<button
							aria-label="Change the repo link"
							className="grid size-7 shrink-0 place-items-center rounded-full text-navy-soft transition-colors hover:bg-black/5 hover:text-navy"
							onClick={() => {
								setDraft(current)
								setError(null)
								setEditing(true)
							}}
							type="button"
						>
							<IconPencil className="text-sm" />
						</button>
					</>
				) : (
					<button
						className="hand text-[0.82rem] text-violet-deep underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
						onClick={() => {
							setDraft("")
							setError(null)
							setEditing(true)
						}}
						type="button"
					>
						add a repo link
					</button>
				)}
			</div>
		)
	}

	return (
		<form
			className={cx("grid gap-2", className)}
			onSubmit={e => {
				e.preventDefault()
				save()
			}}
		>
			<label className="sr-only" htmlFor={id}>
				Repo link
			</label>
			<input
				aria-describedby={error ? `${id}-err` : undefined}
				aria-invalid={!!error || undefined}
				autoComplete="url"
				className={cx(inputClass, "py-2 text-[0.88rem]")}
				id={id}
				inputMode="url"
				onChange={e => {
					setDraft(e.target.value)
					if (error) setError(null)
				}}
				onKeyDown={e => {
					if (e.key === "Escape") setEditing(false)
				}}
				placeholder="github.com/you/your-project"
				spellCheck={false}
				value={draft}
			/>
			{error && (
				<p className="text-[0.8rem] font-semibold text-coral-deep" id={`${id}-err`} role="alert">
					{error}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button disabled={saving} size="sm" type="submit" variant="solid">
					{saving ? "Saving…" : "Save"}
				</Button>
				<Button disabled={saving} onClick={() => setEditing(false)} size="sm" type="button" variant="ghost">
					Cancel
				</Button>
				{current && (
					<Button
						className="ml-auto"
						disabled={saving}
						onClick={() => {
							setDraft("")
							void (async () => {
								setSaving(true)
								const refused = await setProjectRepo(project.id, null)
								setSaving(false)
								if (refused) setError(refused)
								else setEditing(false)
							})()
						}}
						size="sm"
						type="button"
						variant="ghost"
					>
						Remove
					</Button>
				)}
			</div>
		</form>
	)
}
