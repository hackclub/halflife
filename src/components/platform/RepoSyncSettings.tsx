"use client"

import { useCallback, useEffect, useState } from "react"
import { IconCheck, IconWarning } from "@/components/platform/icons"
import { Button, Chip } from "@/components/platform/ui"
import { errorMessage } from "@/lib/api-error"
import { linkForge } from "@/lib/auth-client"
import { cx } from "@/lib/cx"
import { displayRepo } from "@/lib/repo"
import { useStore } from "@/lib/store"
import { ago } from "./reels/format"

/**
 * Repo sync – the control that mirrors a project's devlogs and parts list into the maker's own repository, on whichever code forge they keep it on.
 *
 * Two states, one component: no forge linked, and linked. The choice of repo is a picker rather than a text field because the sync has to push, and a repo typed by hand is one the token may not be able to write to – which would fail on every entry afterwards with a 403 nobody can act on from here. The picked value is the repo's full URL, so the forge it belongs to travels with it.
 *
 * The first commit happens when the sync is switched on (the server does it before the setting takes), so "on" always means "the files are in the repo", never a promise that the next write will try.
 */

interface WritableRepo {
	defaultBranch: string
	fullName: string
	name: string
	ownerPath: string
	private: boolean
	pushedAt: string | null
	/** The repo's forge URL – what the sync stores and links out to. */
	url: string
}

interface SyncState {
	enabled: boolean
	error: string | null
	forge: string | null
	linkedForges: string[]
	/** The project's own repo link, what the sync target is compared against. */
	projectRepo: string | null
	repo: string | null
	repos: WritableRepo[]
	reposError: string | null
	syncedAt: number | null
	/** True when the sync writes to a different repo than the project points at. */
	syncRepoDiffers: boolean
}

type SyncPayload = Omit<SyncState, "error"> & { error?: { message?: string } }

/** The forges a maker can connect here, and how each is named in the UI. */
const FORGES = [
	{ id: "github", label: "GitHub" },
	{ id: "gitlab", label: "GitLab" },
] as const

// The reels' relative-time wording, reused rather than re-spelled: "3h ago" reads the same everywhere, and this file had its own copy that said "3 hours ago" and rendered a bare locale date past a day.
const when = (ms: number) => ago(new Date(ms))

export function RepoSyncSettings({
	projectId,
	/**
	 * Called after a successful enable/sync so a host page (the onboarding step, say) can move on. The project page passes nothing.
	 */
	onEnabled,
	/** Compact copy for the onboarding step, where there is less room. */
	compact = false,
}: {
	projectId: string
	onEnabled?(): void
	compact?: boolean
}) {
	const { linkSyncRepoToProject } = useStore()
	const [state, setState] = useState<SyncState | null>(null)
	const [loading, setLoading] = useState(true)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [picked, setPicked] = useState<string | null>(null)
	const [linking, setLinking] = useState(false)
	const [linked, setLinked] = useState(false)

	const load = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const res = await fetch(`/api/projects/${projectId}/repo-sync`, { cache: "no-store" })
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- untyped source at this boundary
			const body = (await res.json().catch(() => null)) as SyncPayload | null
			if (!res.ok) throw new Error(body?.error?.message ?? "Could not load the sync settings")
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowing the compiler cannot verify without a runtime check
			setState(body as SyncState)
			// Pre-select the repo a project already points at, if it is one of the writable ones, so re-enabling does not need the picker used again.
			const current = body?.repo ?? null
			setPicked(p => p ?? body?.repos.find(r => r.url === current)?.url ?? null)
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not load the sync settings")
		} finally {
			setLoading(false)
		}
	}, [projectId])

	useEffect(() => {
		// fetching on mount and on a new project
		void load()
	}, [load])

	async function send(method: "POST" | "PUT", body?: unknown) {
		setBusy(true)
		setError(null)
		try {
			const res = await fetch(`/api/projects/${projectId}/repo-sync`, {
				body: body ? JSON.stringify(body) : undefined,
				headers: body ? { "content-type": "application/json" } : undefined,
				method,
			})
			const payload: unknown = await res.json().catch(() => null)
			if (!res.ok) {
				setError(errorMessage(payload, "That did not work. Try again."))
				return false
			}
			await load()
			return true
		} catch {
			setError("Could not reach the server. Try again.")
			return false
		} finally {
			setBusy(false)
		}
	}

	/**
	 * Point the project's own repo link at the repo the sync writes to. The store updates the project row and refreshes, so the Repo checks box above re-runs against the new link on its own.
	 */
	async function linkProject() {
		setLinking(true)
		setError(null)
		const refused = await linkSyncRepoToProject(projectId)
		setLinking(false)
		if (refused) setError(refused)
		else setLinked(true)
	}

	if (loading && !state)
		return (
			<p aria-live="polite" className="hand text-[0.84rem] text-navy-soft">
				checking your repos…
			</p>
		)

	if (!state)
		return (
			<p className="text-[0.85rem] font-semibold text-coral-deep" role="alert">
				{error ?? "Could not load the sync settings"}
			</p>
		)

	// No forge linked: the whole feature is gated on it, so the prompt is the panel. A maker picks whichever service their project already lives on.
	if (state.linkedForges.length === 0)
		return (
			<div className="grid gap-3">
				<p className="text-[0.9rem] leading-relaxed text-navy-soft">
					{compact
						? "Connect a code forge to keep your devlogs and parts list in your project's repo."
						: "Connect the code forge your project lives on (GitHub or GitLab) to mirror this project's devlogs and parts list into its repository. Syncing needs permission to write to the repo you choose; nothing else on your account is touched."}
				</p>
				{error && (
					<p className="text-[0.85rem] font-semibold text-coral-deep" role="alert">
						{error}
					</p>
				)}
				<div className="flex flex-wrap gap-2">
					{FORGES.map(forge => (
						<Button
							key={forge.id}
							onClick={() => linkForge(forge.id, window.location.pathname + window.location.search)}
							variant="solid"
						>
							Connect {forge.label}
						</Button>
					))}
				</div>
			</div>
		)

	if (state.enabled) {
		const forge = state.forge ? FORGES.find(f => f.id === state.forge) : undefined
		return (
			<div className="grid gap-3">
				<p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
					<Chip tone="teal">
						<IconCheck className="text-sm" /> Syncing
					</Chip>
					<a
						className="text-[0.9rem] font-semibold text-navy underline decoration-line-strong decoration-dashed underline-offset-4 transition-colors hover:decoration-violet"
						href={state.repo ?? "#"}
						rel="noopener noreferrer"
						target="_blank"
					>
						{state.repo ? state.repo.replace(/^https?:\/\//, "") : "the repo"}
					</a>
					{state.syncedAt && <span className="hand text-[0.82rem] text-navy-soft">synced {when(state.syncedAt)}</span>}
				</p>
				<p className="text-[0.85rem] leading-relaxed text-navy-soft">
					Your journal entries land in <code className="hand text-navy">JOURNAL.md</code> and your parts list in{" "}
					<code className="hand text-navy">BOM.csv</code>, in the repo&apos;s default branch. Each new entry updates
					them automatically.
				</p>

				{state.error && (
					<p
						className="flex items-start gap-2 rounded-xl bg-coral/10 px-3.5 py-2.5 text-[0.85rem] font-semibold text-coral-deep"
						role="alert"
					>
						<IconWarning className="mt-0.5 shrink-0" />
						{/* The server's message is now complete for its own status – rate limit, outage, permissions, a moved repo – so nothing forge-specific is appended here. The "Reconnect" button below is the standing offer. */}
						<span>The last sync did not land: {state.error}</span>
					</p>
				)}
				{error && (
					<p className="text-[0.85rem] font-semibold text-coral-deep" role="alert">
						{error}
					</p>
				)}

				{state.syncRepoDiffers && !linked && (
					<LinkProjectButton
						busy={linking}
						existing={state.projectRepo}
						onClick={() => linkProject()}
						repo={state.repo}
					/>
				)}
				{linked && (
					<p className="hand text-[0.82rem] text-teal-ink">
						the project now links to {state.repo ? displayRepo(state.repo) : "the repo"}.
					</p>
				)}

				<div className="flex flex-wrap gap-2">
					<Button disabled={busy} onClick={() => send("PUT")} size="sm" variant="outline">
						{busy ? "Syncing…" : "Sync now"}
					</Button>
					{forge && (
						<Button
							disabled={busy}
							onClick={() => linkForge(forge.id, window.location.pathname + window.location.search)}
							size="sm"
							variant="outline"
						>
							Reconnect {forge.label}
						</Button>
					)}
					<Button disabled={busy} onClick={() => send("POST", { enabled: false })} size="sm" variant="ghost">
						Turn off
					</Button>
				</div>
			</div>
		)
	}

	// Linked, off: pick a repo and switch it on.
	return (
		<div className="grid gap-3">
			<p className="text-[0.9rem] leading-relaxed text-navy-soft">
				{compact
					? "Keep your devlogs and parts list in your project's repo."
					: "Pick the repository to mirror this project into. Your journal entries become JOURNAL.md and your parts list becomes BOM.csv, updated automatically as you log work."}
			</p>

			{state.reposError ? (
				<p className="text-[0.85rem] font-semibold text-coral-deep" role="alert">
					{state.reposError}
				</p>
			) : state.repos.length === 0 ? (
				<p className="hand text-[0.86rem] text-navy-soft">
					no repositories you can push to were found. Make one on{" "}
					{state.linkedForges.length > 1
						? "GitHub or GitLab"
						: state.linkedForges[0] === "gitlab"
							? "GitLab"
							: "GitHub"}
					, then check again.
				</p>
			) : (
				<label className="grid gap-1.5">
					<span className="label text-violet-deep">Repository</span>
					<select
						className="block w-full rounded-xl border-2 border-field bg-white px-3.5 py-2.5 text-[0.9rem] text-navy outline-none transition-colors hover:border-navy-soft focus:border-violet"
						onChange={e => setPicked(e.target.value || null)}
						value={picked ?? ""}
					>
						<option value="">Choose a repo…</option>
						{state.repos.map(r => (
							<option key={r.url} value={r.url}>
								{r.fullName}
								{r.private ? " (private)" : ""}
							</option>
						))}
					</select>
				</label>
			)}

			{error && (
				<p className="text-[0.85rem] font-semibold text-coral-deep" role="alert">
					{error}
				</p>
			)}

			<div className="flex flex-wrap gap-2">
				<Button
					disabled={busy || !picked}
					onClick={() => {
						void (async () => {
							if (await send("POST", { enabled: true, repo: picked })) onEnabled?.()
						})()
					}}
					size="sm"
					variant="solid"
				>
					{busy ? "Writing to the repo…" : "Turn on syncing"}
				</Button>
				<Button disabled={busy || loading} onClick={() => load()} size="sm" variant="ghost">
					Check again
				</Button>
				{state.linkedForges.map(id => {
					const forge = FORGES.find(f => f.id === id)
					if (!forge) return null
					return (
						<Button
							disabled={busy}
							key={id}
							onClick={() => linkForge(forge.id, window.location.pathname + window.location.search)}
							size="sm"
							variant="outline"
						>
							Reconnect {forge.label}
						</Button>
					)
				})}
			</div>
			<p className={cx("hand text-[0.8rem] text-navy-soft", compact && "hidden")}>
				it writes JOURNAL.md and BOM.csv to the repo&apos;s default branch, with one commit per update.
			</p>
		</div>
	)
}

/**
 * The offer to make the project's repo link and the sync's repo the same repo.
 *
 * Only rendered when the two genuinely differ. The copy says which link it will change and to what, because a maker who has set both by hand should not have to guess which direction "link" means here.
 */
function LinkProjectButton({
	repo,
	existing,
	busy,
	onClick,
}: {
	repo: string | null
	existing: string | null
	busy: boolean
	onClick(): void
}) {
	const to = repo ? displayRepo(repo) : "the repo"
	return (
		<p className="rounded-xl bg-gold-pale/60 px-3.5 py-2.5 text-[0.85rem] leading-relaxed text-navy">
			The sync writes to <span className="font-semibold">{to}</span>, but the project links to{" "}
			<span className="font-semibold">{existing ? displayRepo(existing) : "no repo"}</span>.{" "}
			<Button className="ml-1 align-baseline" disabled={busy} onClick={onClick} size="sm" variant="outline">
				{busy ? "Linking…" : "Link this project to that repo"}
			</Button>
		</p>
	)
}
