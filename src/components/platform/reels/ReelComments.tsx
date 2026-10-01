"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { Avatar } from "@/components/platform/Avatar"
import { IconSend, IconX } from "@/components/platform/icons"
import { cx } from "@/components/platform/ui"
import type { FeedItem } from "@/lib/feed"
import { ago, compact } from "./format"

interface Comment {
	id: string
	body: string
	createdAt: string
	author: { id: string; name: string | null; image: string | null }
	mine: boolean
}

interface Thread {
	items: Comment[]
	nextCursor: string | null
	status: "loading" | "ready" | "error"
}

const PAGE = 20
const MAX_LENGTH = 1000

/**
 * The conversation under the current reel.
 *
 * It follows the stage: when the reel changes, so does the thread. Threads are
 * kept for the visit, so scrolling back to a reel shows its comments at once
 * instead of a spinner for something already read.
 */
export function ReelComments({
	reel,
	viewer,
	onPatch,
	onClose,
	className,
}: {
	reel: FeedItem | null
	viewer: { name: string; image: string | null }
	onPatch: (id: string, next: Partial<FeedItem>) => void
	onClose: () => void
	className?: string
}) {
	// Two ReelComments can be mounted at once (the side panel and the narrow
	// sheet), so fixed ids would collide; useId scopes them to this instance.
	const uid = useId()
	const [threads, setThreads] = useState<Record<string, Thread>>({})
	const [draft, setDraft] = useState("")
	const [sending, setSending] = useState(false)
	const [sendError, setSendError] = useState<string | null>(null)
	const list = useRef<HTMLOListElement>(null)

	const reelId = reel?.id ?? null
	// No entry yet reads as loading: the first fetch for a reel is started by
	// the effect below, which must not set state before its await.
	const thread = reelId ? threads[reelId] : undefined

	const patchThread = useCallback((id: string, next: (prev: Thread | undefined) => Thread) => {
		setThreads((all) => ({ ...all, [id]: next(all[id]) }))
	}, [])

	// Everything it sets lands after the await, so it is safe to start from an
	// effect. Callers that want the "loading" state shown mark it themselves.
	const load = useCallback(
		async (id: string, cursor: string | null) => {
			try {
				const query = new URLSearchParams({ limit: String(PAGE) })
				if (cursor) query.set("cursor", cursor)
				const res = await fetch(`/api/posts/${id}/comments?${query}`)
				if (!res.ok) throw new Error(String(res.status))
				const page = (await res.json()) as { items: Comment[]; nextCursor: string | null }
				patchThread(id, (prev) => {
					const had = cursor ? (prev?.items ?? []) : []
					const seen = new Set(had.map((c) => c.id))
					return {
						items: [...had, ...page.items.filter((c) => !seen.has(c.id))],
						nextCursor: page.nextCursor,
						status: "ready",
					}
				})
			} catch {
				patchThread(id, (prev) => ({
					items: prev?.items ?? [],
					nextCursor: prev?.nextCursor ?? null,
					status: "error",
				}))
			}
		},
		[patchThread],
	)

	/** A fetch the reader asked for — retry, or the next page — shows that it is working. */
	function fetchAgain(id: string, cursor: string | null) {
		patchThread(id, (prev) => ({
			items: prev?.items ?? [],
			nextCursor: prev?.nextCursor ?? null,
			status: "loading",
		}))
		void load(id, cursor)
	}

	// Fetching the thread for whichever reel is current is exactly the
	// external-system sync an effect is for. Once asked, a reel keeps its
	// thread for the visit, so scrolling back does not ask again.
	const asked = thread !== undefined
	useEffect(() => {
		if (!reelId || asked) return
		// eslint-disable-next-line react-hooks/set-state-in-effect -- every update in `load` lands after its await
		void load(reelId, null)
	}, [reelId, asked, load])

	// A different reel is a different conversation: whatever was half-typed for
	// the last one is not an answer to this one.
	const [draftFor, setDraftFor] = useState(reelId)
	if (draftFor !== reelId) {
		setDraftFor(reelId)
		setDraft("")
		setSendError(null)
	}

	async function send(e: React.FormEvent) {
		e.preventDefault()
		const body = draft.trim()
		if (!reel || !body || sending) return
		setSending(true)
		setSendError(null)
		try {
			const res = await fetch(`/api/posts/${reel.id}/comments`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ body }),
			})
			if (!res.ok) {
				const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
				setSendError(err?.error?.message ?? "That comment did not post. Try again.")
				return
			}
			const { comment } = (await res.json()) as { comment: Comment }
			patchThread(reel.id, (prev) => ({
				items: [...(prev?.items ?? []), comment],
				nextCursor: prev?.nextCursor ?? null,
				status: "ready",
			}))
			onPatch(reel.id, { commentCount: reel.commentCount + 1 })
			setDraft("")
			// The new comment is at the end of the thread; take the reader to it.
			requestAnimationFrame(() => list.current?.lastElementChild?.scrollIntoView({ block: "nearest" }))
		} catch {
			setSendError("Could not reach the server. Your comment is still here — try again.")
		} finally {
			setSending(false)
		}
	}

	async function remove(c: Comment) {
		if (!reel) return
		const id = reel.id
		const count = reel.commentCount
		// Gone at once; put back where it was if the server says no.
		let at = -1
		patchThread(id, (prev) => {
			const items = prev?.items ?? []
			at = items.findIndex((x) => x.id === c.id)
			return { items: items.filter((x) => x.id !== c.id), nextCursor: prev?.nextCursor ?? null, status: "ready" }
		})
		onPatch(id, { commentCount: Math.max(0, count - 1) })
		try {
			const res = await fetch(`/api/comments/${c.id}`, { method: "DELETE" })
			if (!res.ok) throw new Error(String(res.status))
		} catch {
			patchThread(id, (prev) => {
				const items = [...(prev?.items ?? [])]
				items.splice(at < 0 ? items.length : at, 0, c)
				return { items, nextCursor: prev?.nextCursor ?? null, status: "ready" }
			})
			onPatch(id, { commentCount: count })
		}
	}

	const count = reel?.commentCount ?? 0

	return (
		<section aria-labelledby={`${uid}-title`} className={cx("flex min-h-0 flex-col text-navy", className)}>
			<header className="flex shrink-0 items-center gap-2 border-b border-dashed border-line px-5 py-3.5">
				<h2 id={`${uid}-title`} className="label text-violet-deep">
					Comments
				</h2>
				<span className="label rounded-full bg-violet-pale px-2 py-0.5 text-violet-deep tabular-nums">
					{compact(count)}
				</span>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close comments"
					className="ml-auto grid size-8 place-items-center rounded-full text-navy-faint transition-colors hover:bg-black/5 hover:text-navy"
				>
					<IconX className="text-base" />
				</button>
			</header>

			<div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
				{!reel ? null : !thread || (thread.status === "loading" && thread.items.length === 0) ? (
					<ul aria-label="Loading comments" className="grid gap-5">
						{[0, 1, 2].map((i) => (
							<li key={i} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 motion-safe:animate-pulse">
								<span className="size-9 rounded-full bg-black/[.06]" />
								<span className="grid content-start gap-2 pt-1">
									<span className="h-3 w-24 rounded-full bg-black/[.06]" />
									<span className="h-3.5 w-full max-w-[14rem] rounded-full bg-black/[.06]" />
								</span>
							</li>
						))}
					</ul>
				) : thread.status === "error" && thread.items.length === 0 ? (
					<div className="grid justify-items-center gap-3 py-10 text-center">
						<p className="hand text-[0.9rem] text-coral-deep">the comments did not load.</p>
						<button
							type="button"
							onClick={() => fetchAgain(reel.id, null)}
							className="label rounded-full border-2 border-line px-4 py-2 text-navy-soft transition-colors hover:border-navy hover:text-navy"
						>
							Try again
						</button>
					</div>
				) : thread.items.length === 0 ? (
					<div className="grid justify-items-center gap-1 py-12 text-center">
						<p className="hand text-[0.98rem] text-navy">nobody has said anything yet.</p>
						<p className="hand text-[0.86rem] text-navy-soft">say what you think of the build.</p>
					</div>
				) : (
					<>
						<ol ref={list} className="grid gap-5">
							{thread.items.map((c) => (
								<li key={c.id} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3">
									<Avatar name={c.author.name} image={c.author.image} className="size-9 text-[0.88rem]" />
									<div className="min-w-0">
										<p className="flex min-w-0 items-baseline gap-2">
											<span className="truncate text-[0.84rem] font-extrabold text-navy">
												{c.author.name ?? "A maker"}
											</span>
											{c.mine && <span className="label shrink-0 text-violet-deep">you</span>}
										</p>
										<p className="mt-0.5 text-[0.9rem] leading-snug whitespace-pre-line [overflow-wrap:anywhere] text-navy">
											{c.body}
										</p>
										<p className="hand mt-1 flex items-center gap-3.5 text-[0.76rem] text-navy-soft">
											<time dateTime={c.createdAt}>{ago(c.createdAt)}</time>
											{c.mine && (
												<button
													type="button"
													onClick={() => void remove(c)}
													className="underline decoration-dashed underline-offset-4 transition-colors hover:text-coral-deep"
												>
													delete
												</button>
											)}
										</p>
									</div>
								</li>
							))}
						</ol>
						{thread.nextCursor && (
							<button
								type="button"
								disabled={thread.status === "loading"}
								onClick={() => fetchAgain(reel.id, thread.nextCursor)}
								className="hand mt-5 text-[0.84rem] text-violet-deep underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
							>
								{thread.status === "loading" ? "loading…" : "show older comments"}
							</button>
						)}
					</>
				)}
			</div>

			<form
				onSubmit={send}
				className="shrink-0 border-t border-dashed border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
			>
				<div className="flex items-center gap-2.5">
					<Avatar name={viewer.name} image={viewer.image} className="size-9 text-[0.88rem]" />
					<label htmlFor={`${uid}-comment`} className="sr-only">
						Add a comment
					</label>
					<input
						id={`${uid}-comment`}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						maxLength={MAX_LENGTH}
						disabled={!reel}
						autoComplete="off"
						placeholder="Add a comment…"
						className="sketch h-11 min-w-0 flex-1 rounded-xl bg-white px-4 text-[0.9rem] text-navy outline-none placeholder:text-navy-faint"
						style={{ "--sk-color": "var(--color-line-strong)", "--sk-radius": "12px" } as React.CSSProperties}
					/>
					<button
						type="submit"
						disabled={!draft.trim() || sending || !reel}
						aria-label="Post comment"
						className="grid size-11 shrink-0 place-items-center rounded-xl border-2 border-violet-deep bg-violet text-white transition-[background-color,transform] duration-150 hover:bg-violet-deep active:translate-y-px disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-line disabled:text-white"
					>
						<IconSend className="text-[1.1rem]" />
					</button>
				</div>
				{sendError && (
					<p role="alert" className="hand mt-2 pl-12 text-[0.78rem] text-coral-deep">
						{sendError}
					</p>
				)}
			</form>
		</section>
	)
}
