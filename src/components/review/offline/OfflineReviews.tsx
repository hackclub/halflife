"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useConfirm } from "@/app/components/ui/useConfirm"
import { ReviewApiError } from "@/components/review/api"
import { downloadSubmissions, type PackProgress } from "@/components/review/offline/pack"
import {
	type OfflinePack,
	type Outbox,
	offlineSupported,
	queuedFor,
	readDetail,
	readOutbox,
	readPacks,
	readViewer,
	registerWorker,
	removePack,
	type StoredDetail,
	storageEstimate,
	updateOutbox,
	writeDetail,
} from "@/components/review/offline/store"
import { type Conflicts, checkConflicts, sendReview } from "@/components/review/offline/sync"
import { type ReviewRuntime, ReviewRuntimeProvider } from "@/components/review/runtime"
import { ShipReview } from "@/components/review/ShipReview"
import { FormErrors, PageHead, Paper } from "@/components/review/ui"
import { HardLink } from "@/components/site/HardLink"
import type { ReviewDetail, ReviewViewer } from "@/lib/review-platform/types"

/**
 * Offline reviews: download submissions while connected, review them with no connection, send the reviews when back online.
 *
 * Reviewing uses the review screen itself (`ShipReview`) on an offline runtime: its writes go to the outbox instead of the server, and its moves go between downloaded submissions on this page. The page never navigates while reviewing, so it keeps working from the copy the service worker kept of it. Fabricate's offline reviews, on Half Life's screen.
 */

const OPEN_KEY = "halflife:offline-open"
const NEEDS_CONNECTION = "This needs a connection. Do it once you're back online."
// Far enough ahead that the screen treats the review as held by you for as long as you're offline. The real claim is taken when the review is sent.
const OFFLINE_CLAIM_UNTIL = "2999-01-01T00:00:00.000Z"

const formatBytes = (bytes: number): string =>
	bytes >= 1e9
		? `${(bytes / 1e9).toFixed(1)} GB`
		: bytes >= 1e6
			? `${(bytes / 1e6).toFixed(1)} MB`
			: `${Math.round(bytes / 1e3)} KB`

const subscribeNever = (): (() => void) => () => undefined

const idFromHref = (href: string): string | null => /^\/reviews\/([^/?#]+)/.exec(href)?.[1] ?? null

const sessionGet = (key: string): string | null => {
	try {
		return sessionStorage.getItem(key)
	} catch {
		return null
	}
}

const sessionSet = (key: string, value: string | null): void => {
	try {
		if (value === null) sessionStorage.removeItem(key)
		else sessionStorage.setItem(key, value)
	} catch {
		// Only which submission was open; losing it opens the list instead.
	}
}

/** Whether the browser believes it is connected, kept current. */
function useOnline(): boolean {
	const [online, setOnline] = useState(true)
	useEffect(() => {
		const update = (): void => setOnline(navigator.onLine)
		update()
		window.addEventListener("online", update)
		window.addEventListener("offline", update)
		return () => {
			window.removeEventListener("online", update)
			window.removeEventListener("offline", update)
		}
	}, [])
	return online
}

/** The downloaded detail as the offline screen shows it: held by you, with "next" being the next downloaded submission you haven't decided. */
function offlineDetail(detail: ReviewDetail, packs: OfflinePack[], outbox: Outbox): ReviewDetail {
	const open = packs.filter(pack => pack.status === "ready" && !outbox[pack.id]?.decision)
	const index = open.findIndex(pack => pack.id === detail.ship.id)
	const next =
		open.slice(index + 1).find(pack => pack.id !== detail.ship.id) ?? open.find(pack => pack.id !== detail.ship.id)
	return {
		...detail,
		nextId: next?.id ?? null,
		// A pack downloaded before "Flags & notes" has no notes.
		notes: detail.notes ?? [],
		ship: {
			...detail.ship,
			claimExpiresAt: detail.ship.status === "pending" ? OFFLINE_CLAIM_UNTIL : null,
			claimedByViewer: detail.ship.status === "pending",
			claimerName: null,
		},
	}
}

export function OfflineReviews() {
	const online = useOnline()
	// Read in the browser only; the server draws the page as if supported, and the answer never changes after that.
	const supported = useSyncExternalStore(subscribeNever, offlineSupported, () => true)
	const [packs, setPacks] = useState<OfflinePack[]>([])
	const [outbox, setOutbox] = useState<Outbox>({})
	const [viewer, setViewer] = useState<ReviewViewer | null>(null)
	const [storage, setStorage] = useState<{ quota: number; usage: number } | null>(null)
	const [openId, setOpenId] = useState<string | null>(null)
	const [stored, setStored] = useState<StoredDetail | null>(null)
	const openRef = useRef<string | null>(null)
	const [pendingIds, setPendingIds] = useState<string[]>([])
	const [videos, setVideos] = useState(true)
	const [progress, setProgress] = useState<PackProgress | null>(null)
	const [errors, setErrors] = useState<string[]>([])
	const [checks, setChecks] = useState<{ [id: string]: Conflicts | "checking" | "sending" | undefined }>({})
	const { confirm, dialog } = useConfirm()

	const reload = useCallback(async () => {
		const [nextPacks, nextOutbox, nextViewer, estimate] = await Promise.all([
			readPacks(),
			readOutbox(),
			readViewer(),
			storageEstimate(),
		])
		setPacks(nextPacks)
		setOutbox(nextOutbox)
		setViewer(nextViewer)
		setStorage(estimate)
	}, [])

	// First load: what's downloaded, which submission was open, and any `?add=` list from the queue.
	useEffect(() => {
		if (!offlineSupported()) return
		void (async () => {
			try {
				await registerWorker()
			} catch {
				// Downloading registers it again, and says so if it fails.
			}
			const url = new URL(location.href)
			const add = (url.searchParams.get("add") ?? "").split(",").filter(Boolean)
			if (add.length > 0) {
				url.searchParams.delete("add")
				history.replaceState(history.state, "", url)
			}
			await reload()
			setPendingIds(add)
			setOpenId(sessionGet(OPEN_KEY))
		})()
	}, [reload])

	/** Reads the open submission back from its download – after opening it, and after every change made to it offline. */
	const loadOpen = useCallback(async () => {
		const id = openRef.current
		if (!id) return
		const found = await readDetail(id)
		if (openRef.current !== id) return
		if (found) setStored(found)
		else {
			openRef.current = null
			setOpenId(null)
			sessionSet(OPEN_KEY, null)
		}
	}, [])

	useEffect(() => {
		openRef.current = openId
		void loadOpen()
	}, [loadOpen, openId])

	const open = useCallback((id: string | null) => {
		sessionSet(OPEN_KEY, id)
		setOpenId(id)
		scrollTo(0, 0)
	}, [])

	const runtime = useMemo<ReviewRuntime>(() => {
		const go = (href: string): void => {
			const id = idFromHref(href)
			void reload()
			open(id && packs.some(pack => pack.id === id && pack.status === "ready") ? id : null)
		}
		const needsConnection = (): Promise<never> => Promise.reject(new ReviewApiError("OFFLINE", NEEDS_CONNECTION))
		return {
			claim: () => Promise.resolve({ expiresAt: OFFLINE_CLAIM_UNTIL }),
			closeDispute: needsConnection,
			async decide(submissionId, body) {
				const detail = await readDetail(submissionId)
				if (!detail) throw new ReviewApiError("OFFLINE", "This submission isn't downloaded")
				await updateOutbox(next => {
					const queued = queuedFor(next, submissionId, detail)
					queued.decision = body
					queued.decidedAt = new Date().toISOString()
					queued.error = null
				})
				await reload()
			},
			mediaSrc: (url: string) =>
				/^https?:\/\//.test(url) && new URL(url).origin !== location.origin
					? `/reviews/offline/media?${new URLSearchParams({ url })}`
					: url,
			offline: true,
			overrideDecision: needsConnection,
			push: go,
			refresh: () => {
				void loadOpen()
				void reload()
			},
			releaseQuietly: () => Promise.resolve(),
			replace: go,
			replyToDispute: needsConnection,
			async saveSessionHours(entry) {
				const id = openId
				const detail = id ? await readDetail(id) : null
				if (!id || !detail) throw new ReviewApiError("OFFLINE", "This submission isn't downloaded")
				await updateOutbox(next => {
					const queued = queuedFor(next, id, detail)
					queued.hours[entry.id] = entry
					queued.error = null
				})
				// The screen reads the entry back from the download, so it shows what was typed after a refresh or a reload.
				await writeDetail(id, {
					...detail,
					detail: {
						...detail.detail,
						entries: detail.detail.entries.map(e =>
							e.id === entry.id
								? {
										...e,
										approvedSeconds: Math.round(entry.hoursApproved * 3600),
										reviewerNote: entry.comments || null,
									}
								: e,
						),
					},
				})
			},
			sendDisputeBack: needsConnection,
		}
	}, [loadOpen, open, openId, packs, reload])

	async function download(ids: string[]): Promise<void> {
		setErrors([])
		try {
			await downloadSubmissions(ids, { videos }, setProgress)
			setPendingIds([])
		} catch (err) {
			setErrors([err instanceof Error ? err.message : "Couldn't download"])
			setProgress(null)
		}
		await reload()
	}

	async function check(id: string): Promise<Conflicts | null> {
		const queued = outbox[id]
		if (!queued) return null
		setChecks(c => ({ ...c, [id]: "checking" }))
		try {
			const result = await checkConflicts(id, queued)
			setChecks(c => ({ ...c, [id]: result }))
			return result
		} catch (err) {
			setChecks(c => ({ ...c, [id]: undefined }))
			setErrors([err instanceof Error ? err.message : "Couldn't check this review"])
			return null
		}
	}

	async function send(id: string, force = false): Promise<void> {
		setErrors([])
		const result = force ? { hard: [], soft: [] } : await check(id)
		if (!result || result.hard.length > 0 || (result.soft.length > 0 && !force)) return
		const queued = outbox[id]
		if (!queued) return
		setChecks(c => ({ ...c, [id]: "sending" }))
		try {
			await sendReview(id, queued)
			setChecks(c => ({ ...c, [id]: undefined }))
		} catch {
			setChecks(c => ({ ...c, [id]: undefined }))
		}
		await reload()
	}

	async function sendAll(): Promise<void> {
		for (const id of Object.keys(outbox)) await send(id)
	}

	async function discard(id: string): Promise<void> {
		const go = await confirm({
			confirmLabel: "Discard",
			message: "It hasn't been sent, and can't be got back.",
			title: "Throw away this offline review?",
			tone: "danger",
		})
		if (go === null) return
		await updateOutbox(next => {
			delete next[id]
		})
		await reload()
	}

	async function forget(id: string): Promise<void> {
		if (
			outbox[id]
			&& (await confirm({
				confirmLabel: "Remove",
				message: "This submission has an unsent review. It stays in the outbox and can still be sent.",
				title: "Remove the download?",
			})) === null
		)
			return
		await removePack(id)
		await reload()
	}

	if (!supported)
		return (
			<>
				<PageHead eyebrow="Reviews" title="Offline reviews" />
				<Paper>
					<p>
						This browser can&rsquo;t keep pages for offline use (no service workers – a private window, for example).
					</p>
				</Paper>
			</>
		)

	if (openId && stored?.detail.ship.id === openId && viewer)
		return (
			<ReviewRuntimeProvider runtime={runtime}>
				<div className="form__actions" style={{ marginBottom: "var(--space-1)" }}>
					<button className="btn btn--ghost btn--sm" onClick={() => open(null)} type="button">
						← Offline reviews
					</button>
					<span className="field__hint">
						Reviewing offline · downloaded {new Date(stored.packedAt).toLocaleString()} ·{" "}
						{outbox[openId]?.decision
							? "decision queued, deciding again replaces it"
							: "decisions are queued until you send them"}
					</span>
				</div>
				<ShipReview detail={offlineDetail(stored.detail, packs, outbox)} viewer={viewer} />
			</ReviewRuntimeProvider>
		)

	const queuedIds = Object.keys(outbox)

	return (
		<>
			<PageHead
				eyebrow="Reviews"
				lead={
					online
						? "Download submissions from the queue, review them with no connection, and send the reviews when you're back online."
						: "You're offline. Downloaded submissions open from this device; reviews wait in the outbox until you're back online."
				}
				title="Offline reviews"
			/>
			<FormErrors errors={errors} />
			{dialog}

			{queuedIds.length > 0 ? (
				<Paper
					actions={
						<button className="btn btn--solid btn--sm" disabled={!online} onClick={() => void sendAll()} type="button">
							Send all
						</button>
					}
					meta={
						online
							? "Each is checked against the submission as it is now before it's sent."
							: "Waiting for a connection."
					}
					title={`Outbox (${queuedIds.length})`}
				>
					<div className="table-wrap">
						<table className="table">
							<thead>
								<tr>
									<th>Submission</th>
									<th>Review</th>
									<th />
								</tr>
							</thead>
							<tbody>
								{queuedIds.map(id => {
									const queued = outbox[id]
									if (!queued) return null
									const state = checks[id]
									const hours = Object.keys(queued.hours).length
									return (
										<tr key={id}>
											<td>{queued.title}</td>
											<td>
												{queued.decision ? queued.decision.result.toLowerCase() : "no decision"}
												{hours > 0 ? ` · ${hours} hours ${hours === 1 ? "edit" : "edits"}` : ""}
												{queued.error ? <div className="field__error">Last try: {queued.error}</div> : null}
												{typeof state === "object" ? (
													<>
														{state.hard.map(reason => (
															<div className="field__error" key={reason}>
																{reason}
															</div>
														))}
														{state.soft.map(reason => (
															<div className="field__hint" key={reason}>
																{reason}
															</div>
														))}
													</>
												) : null}
											</td>
											<td>
												<div className="form__actions">
													{typeof state === "object" && state.hard.length === 0 && state.soft.length > 0 ? (
														<button
															className="btn btn--ink btn--sm"
															disabled={!online}
															onClick={() => void send(id, true)}
															type="button"
														>
															Send anyway
														</button>
													) : (
														<button
															className="btn btn--ink btn--sm"
															disabled={!online || state === "checking" || state === "sending"}
															onClick={() => void send(id)}
															type="button"
														>
															{state === "sending" ? "Sending…" : state === "checking" ? "Checking…" : "Send"}
														</button>
													)}
													{packs.some(pack => pack.id === id) ? (
														<button className="btn btn--ghost btn--sm" onClick={() => open(id)} type="button">
															Open
														</button>
													) : null}
													<button className="btn btn--ghost btn--sm" onClick={() => void discard(id)} type="button">
														Discard
													</button>
												</div>
											</td>
										</tr>
									)
								})}
							</tbody>
						</table>
					</div>
				</Paper>
			) : null}

			{pendingIds.length > 0 || progress ? (
				<Paper title="Download">
					{progress ? (
						<p>
							{progress.label}… <progress max={progress.total} value={progress.done} />
						</p>
					) : (
						<>
							<p>
								{pendingIds.length} {pendingIds.length === 1 ? "submission" : "submissions"} from the queue. Downloading
								takes the review screen, the repository, journal pictures and Airtable preview of each.
							</p>
							<div className="form__actions">
								<label className="field__hint">
									<input checked={videos} onChange={e => setVideos(e.target.checked)} type="checkbox" /> Include
									timelapse videos (most of the size)
								</label>
								<button
									className="btn btn--solid btn--sm"
									disabled={!online}
									onClick={() => void download(pendingIds)}
									type="button"
								>
									Download
								</button>
								<button className="btn btn--ghost btn--sm" onClick={() => setPendingIds([])} type="button">
									Cancel
								</button>
							</div>
						</>
					)}
				</Paper>
			) : null}

			<DownloadedPaper
				online={online}
				onOpen={open}
				onRemove={id => void forget(id)}
				onRetry={id => void download([id])}
				outbox={outbox}
				packs={packs}
				storage={storage}
			/>
		</>
	)
}

/** The downloaded submissions, with what each holds and what can be done with it. */
function DownloadedPaper({
	onOpen,
	onRemove,
	onRetry,
	online,
	outbox,
	packs,
	storage,
}: {
	onOpen(id: string): void
	onRemove(id: string): void
	onRetry(id: string): void
	online: boolean
	outbox: Outbox
	packs: OfflinePack[]
	storage: { quota: number; usage: number } | null
}) {
	const ready = packs.filter(pack => pack.status === "ready")
	return (
		<Paper
			meta={
				storage
					? `${formatBytes(storage.usage)} used on this device, of ${formatBytes(storage.quota)} the browser allows.`
					: undefined
			}
			title={`Downloaded (${ready.length})`}
		>
			{packs.length === 0 ? (
				<p className="field__hint">
					Nothing yet. In the <HardLink href="/reviews">review queue</HardLink>, filter to what you want and use “Save
					for offline”.
				</p>
			) : (
				<div className="table-wrap">
					<table className="table">
						<thead>
							<tr>
								<th>Submission</th>
								<th>Maker</th>
								<th>Downloaded</th>
								<th className="num">Size</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{packs.map(pack => (
								<tr key={pack.id}>
									<td>
										{pack.title} <span className="field__hint">{pack.kind}</span>
										{pack.status === "failed" ? <div className="field__error">{pack.error ?? "Failed"}</div> : null}
										{pack.status === "downloading" ? <div className="field__hint">Downloading…</div> : null}
										{pack.missing > 0 ? (
											<div className="field__hint">
												{pack.missing} {pack.missing === 1 ? "thing" : "things"} couldn&rsquo;t be downloaded (pictures,
												files or videos)
											</div>
										) : null}
										{outbox[pack.id]?.decision ? (
											<div className="field__hint">
												Decision queued: {outbox[pack.id]?.decision?.result.toLowerCase()}
											</div>
										) : null}
									</td>
									<td>{pack.maker}</td>
									<td>{new Date(pack.packedAt).toLocaleString()}</td>
									<td className="num">{formatBytes(pack.bytes)}</td>
									<td>
										<div className="form__actions">
											{pack.status === "ready" ? (
												<button className="btn btn--ink btn--sm" onClick={() => onOpen(pack.id)} type="button">
													Review
												</button>
											) : null}
											{pack.status === "failed" && online ? (
												<button className="btn btn--ghost btn--sm" onClick={() => onRetry(pack.id)} type="button">
													Retry
												</button>
											) : null}
											<button className="btn btn--ghost btn--sm" onClick={() => onRemove(pack.id)} type="button">
												Remove
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</Paper>
	)
}
