"use client"

import { useCallback, useEffect, useState } from "react"
import { z } from "zod"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { Button, Callout } from "@/app/components/ui"
import { errorMessage } from "@/lib/api-error"
import { formatUtcDateTime } from "@/lib/deadline"
import { sendJson, useAction } from "@/lib/use-action"

const StateSchema = z.object({
	count: z.number(),
	githubRepo: z.string().nullable(),
	lastSync: z
		.object({
			count: z.number().nullable(),
			createdAt: z.string(),
			id: z.string(),
			path: z.string().nullable(),
			undoBlock: z.string().nullable(),
		})
		.nullable(),
	locked: z.string().nullable(),
	repoSupported: z.boolean(),
})
type BomState = z.infer<typeof StateSchema>

const PreviewSchema = z.object({
	existing: z.number(),
	lines: z.array(z.object({ name: z.string(), quantity: z.number() })),
	locked: z.string().nullable(),
	path: z.string(),
	skipped: z.array(z.unknown()),
})
type BomPreview = z.infer<typeof PreviewSchema>

/** How many of the file's part names the preview lists before summarising the rest. */
const PREVIEW_NAMES = 8

/** The project's state, read as the console draws it: a refusal comes back as its sentence, a good answer as the parsed state. */
async function readState(url: string): Promise<BomState | string> {
	let res: Response
	try {
		res = await fetch(url)
	} catch {
		return "Could not reach the server"
	}
	const payload: unknown = await res.json().catch(() => null)
	if (!res.ok) return errorMessage(payload, `Request failed (${res.status})`)
	const parsed = StateSchema.safeParse(payload)
	return parsed.success ? parsed.data : "The server's answer was not in the expected shape"
}

/**
 * Pull a project's parts list from the `bom*.csv` in its repo, and put the last pull back if it was wrong.
 *
 * Checking the repo costs nothing: it shows the file found and the lines in it, so the swap is seen before it is made. Replacing is confirmed, and refused while the list is locked. The undo is offered only while it can work, and says why when it cannot, so an admin is never left with a button that fails.
 */
export function BomSyncForm({ projectId }: Readonly<{ projectId: string }>) {
	const url = `/api/admin/theme-projects/${projectId}/bom`
	const [state, setState] = useState<BomState | null>(null)
	const [loadError, setLoadError] = useState<string | null>(null)
	const [preview, setPreview] = useState<BomPreview | null>(null)
	const { busy, error, run } = useAction()

	const apply = useCallback((result: BomState | string) => {
		if (typeof result === "string") setLoadError(result)
		else {
			setLoadError(null)
			setState(result)
		}
	}, [])

	const refresh = useCallback(async () => apply(await readState(url)), [apply, url])

	useEffect(() => {
		let current = true
		const load = async (): Promise<void> => {
			const result = await readState(url)
			if (current) apply(result)
		}
		void load()
		return () => {
			current = false
		}
	}, [apply, url])

	if (loadError) return <Callout tone="danger">{loadError}</Callout>
	if (!state) return <p className="hl-hint">Loading the parts list…</p>

	const canPull = state.githubRepo !== null && state.repoSupported
	const pullBlocked = state.locked ?? preview?.locked ?? null

	function check(): void {
		setPreview(null)
		void run(
			"check",
			() => sendJson(url, { body: { apply: false } }),
			data => {
				const parsed = PreviewSchema.safeParse(data)
				setPreview(parsed.success ? parsed.data : null)
			},
		)
	}

	return (
		<div className="hl-stack hl-stack--tight">
			<p className="hl-hint" style={{ marginTop: 0 }}>
				{state.count} {state.count === 1 ? "part" : "parts"} on the page now.
			</p>

			{state.githubRepo ? null : (
				<p className="hl-hint">This project has no repo linked, so there is no parts list to pull.</p>
			)}
			{state.githubRepo && !state.repoSupported ? (
				<p className="hl-hint">
					Half Life can only read GitHub and GitLab repos. The repo for this project is on another service, so its parts
					list has to be edited by hand.
				</p>
			) : null}

			{canPull ? (
				<div className="hl-stack hl-stack--tight">
					<div className="hl-manage-actions">
						<Button disabled={busy !== null} onClick={check} type="button">
							{busy === "check" ? "Checking the repo…" : "Check the repo"}
						</Button>
					</div>
					{preview ? (
						<>
							<p className="hl-hint" style={{ marginTop: 0 }}>
								Found <span className="hl-mono">{preview.path}</span> with {preview.lines.length}{" "}
								{preview.lines.length === 1 ? "part" : "parts"}
								{preview.skipped.length > 0 ? `, ${preview.skipped.length} skipped` : ""}. This replaces the{" "}
								{preview.existing} {preview.existing === 1 ? "part" : "parts"} on the page.
							</p>
							{preview.lines.length > 0 ? (
								<p className="hl-hint" style={{ marginTop: 0 }}>
									{preview.lines
										.slice(0, PREVIEW_NAMES)
										.map(line => `${line.quantity} × ${line.name}`)
										.join(", ")}
									{preview.lines.length > PREVIEW_NAMES ? `, and ${preview.lines.length - PREVIEW_NAMES} more` : ""}
								</p>
							) : null}
							{pullBlocked ? <Callout tone="warning">{pullBlocked}</Callout> : null}
							<div className="hl-manage-actions">
								<ActionButton
									body={{ apply: true }}
									confirm="Replace the parts list with the one in the repo? The list as it is now is kept in the audit log, so this can be undone until the list changes."
									disabled={pullBlocked !== null || preview.lines.length === 0}
									label="Replace parts list"
									onDone={() => {
										setPreview(null)
										void refresh()
									}}
									url={url}
									variant="danger"
								/>
							</div>
						</>
					) : null}
				</div>
			) : null}

			{state.lastSync ? (
				<div className="hl-stack hl-stack--tight">
					<p className="hl-hint" style={{ marginTop: 0 }}>
						Last pulled {formatUtcDateTime(new Date(state.lastSync.createdAt))}
						{state.lastSync.path ? (
							<>
								{" "}
								from <span className="hl-mono">{state.lastSync.path}</span>
							</>
						) : null}
						{state.lastSync.count === null
							? ""
							: `, ${state.lastSync.count} ${state.lastSync.count === 1 ? "part" : "parts"}`}
						.
					</p>
					{state.lastSync.undoBlock ? (
						<p className="hl-hint" style={{ marginTop: 0 }}>
							It cannot be undone: {state.lastSync.undoBlock}
						</p>
					) : (
						<div className="hl-manage-actions">
							<ActionButton
								body={{ auditId: state.lastSync.id }}
								confirm="Put back the parts list as it was before the last pull?"
								label="Undo last pull"
								onDone={() => void refresh()}
								url={`${url}/undo`}
							/>
						</div>
					)}
				</div>
			) : null}

			{error ? <Callout tone="danger">{error}</Callout> : null}
		</div>
	)
}
