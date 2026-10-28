"use client"
import { useState } from "react"
import { fmtDate } from "@/lib/projects"
import type { PhaseDispute } from "@/lib/queries/project-page"
import { sendJson, useAction } from "@/lib/use-action"

/**
 * A dispute and its thread: the maker's opening note, then every reply.
 *
 * The same component on the project page (the maker's view) and the review console (a reviewer's), because the thread is one conversation read from two sides – only the label on each message and the controls change. A reviewer gets the two endings, closing with the decision left standing or sending the hand-in back for a fresh review; a maker gets the reply box, and both only while the dispute is open.
 *
 * It is shared rather than owned by one world, so each caller names the kit it is drawn in. The text, order and controls stay identical; only the surface's own classes change, which keeps the thread native to the project page's sketched panels and to the console's straight-edged ones instead of dropping platform cards and violet buttons into the console.
 */

const SKINS = {
	console: {
		actions: "hl-row",
		body: "whitespace-pre-wrap",
		error: "hl-callout hl-callout--danger",
		form: "hl-stack hl-stack--tight",
		input: "hl-textarea",
		item: "hl-stack hl-stack--tight",
		label: "hl-label-text",
		list: "hl-stack hl-stack--tight",
		meta: "hl-hint",
		outcome: "hl-hint",
		primary: "hl-btn hl-btn--primary",
		root: "hl-panel hl-stack hl-stack--tight",
		secondary: "hl-btn",
	},
	platform: {
		actions: "flex flex-wrap items-center gap-2",
		body: "whitespace-pre-wrap rounded-xl bg-white px-3.5 py-2.5 text-[0.9rem] leading-snug text-navy",
		error: "text-[0.82rem] font-semibold text-coral-deep",
		form: "grid gap-2",
		input:
			"block w-full rounded-xl border-2 border-field bg-white px-3.5 py-2.5 text-[0.9rem] text-navy outline-none placeholder:text-navy-faint transition-colors hover:border-navy-soft focus:border-violet",
		item: "grid gap-1",
		label: "label text-violet-deep",
		list: "grid gap-2.5",
		meta: "hand text-[0.78rem] text-navy-soft",
		outcome: "hand text-[0.84rem] text-navy-soft",
		primary:
			"label inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-violet-dark bg-violet-deep px-3.5 text-[0.76rem] whitespace-nowrap text-white transition-colors duration-150 hover:bg-violet-dark disabled:cursor-not-allowed disabled:opacity-70",
		root: "grid gap-3 rounded-xl border-2 border-line bg-cream/60 p-3.5",
		secondary:
			"label inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-violet bg-transparent px-3.5 text-[0.76rem] whitespace-nowrap text-navy transition-colors duration-150 hover:bg-violet-pale disabled:cursor-not-allowed disabled:opacity-70",
	},
} as const

export function DisputeThread({
	dispute,
	replyUrl,
	viewer,
	surface = "platform",
	closeUrl,
	sendBackUrl,
}: Readonly<{
	dispute: PhaseDispute
	replyUrl: string
	viewer: "maker" | "reviewer"
	/** Which world's kit draws the thread. The copy and controls are the same in both. */
	surface?: "platform" | "console"
	/** Reviewers close the dispute with the decision left standing. */
	closeUrl?: string
	/** Reviewers holding `OVERRIDE_DECISIONS` can instead send the hand-in back for a fresh review. */
	sendBackUrl?: string
}>) {
	const skin = SKINS[surface]
	const { busy, error, refuse, run } = useAction()
	const [body, setBody] = useState("")
	const open = dispute.resolvedAt === null

	const who = (fromReviewer: boolean): string =>
		fromReviewer === (viewer === "reviewer") ? "You" : fromReviewer ? "A reviewer" : "The maker"

	function reply() {
		if (!body.trim()) return refuse("Write a reply first.")
		void run(
			"reply",
			() => sendJson(replyUrl, { body: { body: body.trim() } }),
			() => setBody(""),
		)
	}

	function act(key: string, url: string, confirm: string) {
		if (!window.confirm(confirm)) return
		void run(key, () => sendJson(url))
	}

	const parts = [{ at: dispute.at, body: dispute.note, fromReviewer: false, id: "note" }, ...dispute.messages]

	return (
		<div className={skin.root}>
			<ol className={skin.list}>
				{parts.map(part => (
					<li className={skin.item} key={part.id}>
						<span className={skin.meta}>
							{who(part.fromReviewer)} · {fmtDate(part.at)}
						</span>
						<p className={skin.body}>{part.body}</p>
					</li>
				))}
			</ol>

			{!open ? (
				<p className={skin.outcome}>
					{dispute.outcome === "upheld"
						? `a reviewer sent this back for a fresh review on ${fmtDate(dispute.resolvedAt ?? dispute.at)}.`
						: `a reviewer looked again and the decision stands, closed ${fmtDate(dispute.resolvedAt ?? dispute.at)}.`}
				</p>
			) : (
				<div className={skin.form}>
					<label className={skin.label} htmlFor={`dispute-reply-${dispute.id}`}>
						{viewer === "reviewer" ? "Reply to the maker" : "Add to this dispute"}
					</label>
					<textarea
						className={skin.input}
						id={`dispute-reply-${dispute.id}`}
						maxLength={2000}
						onChange={e => setBody(e.target.value)}
						placeholder={
							viewer === "reviewer" ? "What did the review get wrong, or why does it stand?" : "Answer the reviewer…"
						}
						rows={3}
						value={body}
					/>
					{error ? (
						<p aria-live="polite" className={skin.error} role="alert">
							{error}
						</p>
					) : null}
					<div className={skin.actions}>
						<button className={skin.primary} disabled={busy !== null} onClick={reply} type="button">
							{busy === "reply" ? "Sending…" : "Reply"}
						</button>
						{closeUrl ? (
							<button
								className={skin.secondary}
								disabled={busy !== null}
								onClick={() => act("close", closeUrl, "Close this dispute with the decision left standing?")}
								type="button"
							>
								{busy === "close" ? "Closing…" : "Decision stands"}
							</button>
						) : null}
						{sendBackUrl ? (
							<button
								className={skin.primary}
								disabled={busy !== null}
								onClick={() =>
									act(
										"sendBack",
										sendBackUrl,
										"Send this hand-in back for a fresh review? The current decision is undone and the ship returns to Ari's queue.",
									)
								}
								type="button"
							>
								{busy === "sendBack" ? "Sending back…" : "Send back for review"}
							</button>
						) : null}
					</div>
				</div>
			)}
		</div>
	)
}
