"use client"

import { useEffect, useId, useState } from "react"
import { IconArrowRight, IconCheck } from "@/components/platform/icons"
import { Button } from "@/components/platform/ui"
import { attrUrl } from "@/lib/attr-url"
import { cx } from "@/lib/cx"
import { fmtHours } from "@/lib/numbers"
import {
	PLATFORM_INFO,
	PUBLIC_REEL_HASHTAG,
	PUBLIC_REEL_PLATFORMS,
	type PublicReelPlatform,
	readPublicReelLink,
} from "@/lib/public-reels"
import { isRecord } from "@/lib/unknown"
import { PublicLinksErrorSchema } from "./checkpoint-shared"
import { Modal, ModalTitle } from "./Modal"

/**
 * After a reel posts: would they like to post it online too?
 *
 * Asked once, as a yes-or-no, so saying no costs one click. Yes opens the links – one field per platform, all optional but at least one – with the reminder that makes the post count at the top, because it has to be in the caption *before* they post it: their referral link and the programme's hashtag. Each link is saved as its own Public Reels row against this reel.
 */
export function PublicReelModal({
	postId,
	eyebrow,
	videoUrl,
	onClose,
	start = "ask",
	celebration,
}: {
	postId: string
	eyebrow: string
	/** The clip, so it can be saved and uploaded elsewhere. */
	videoUrl: string | null
	onClose(): void
	/**
	 * "links" skips the question – for the Reels page, where pressing "Add where you posted it" has already answered it.
	 */
	start?: "ask" | "links"
	/**
	 * Set when this sheet is the confirmation of a design hand-in: it congratulates, and says what the hours past the tier turn into once a reviewer approves them. Other callers (a reel posted mid-week, the Reels page) pass nothing and see the plain ask.
	 */
	celebration?: { extraHours: number }
}) {
	const [step, setStep] = useState<"ask" | "links" | "saved">(start)
	const titleId = useId()
	const [values, setValues] = useState<Record<PublicReelPlatform, string>>({
		INSTAGRAM: "",
		TIKTOK: "",
		X: "",
		YOUTUBE: "",
	})
	const [errors, setErrors] = useState<Partial<Record<PublicReelPlatform, string>>>({})
	const [saving, setSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)
	const [referral, setReferral] = useState<
		{ state: "loading" } | { state: "ready"; link: string } | { state: "error" }
	>({ state: "loading" })
	const [copied, setCopied] = useState<"link" | "caption" | null>(null)

	// Asked for only once they say yes: most people will not, and the lookup reaches the signup list.
	useEffect(() => {
		if (step !== "links" || referral.state !== "loading") return
		let cancelled = false
		void (async () => {
			try {
				// A POST, because the route writes: reading a link assigns the referral code and records the address on the signup list.
				const res = await fetch("/api/me/referral", { cache: "no-store", method: "POST" })
				const body: unknown = await res.json().catch(() => null)
				if (cancelled) return
				setReferral(
					res.ok && isRecord(body) && typeof body.link === "string"
						? { link: body.link, state: "ready" }
						: { state: "error" },
				)
			} catch {
				if (!cancelled) setReferral({ state: "error" })
			}
		})()
		return () => {
			cancelled = true
		}
	}, [step, referral.state])

	async function copy(text: string, which: "link" | "caption") {
		try {
			await navigator.clipboard.writeText(text)
			setCopied(which)
			window.setTimeout(() => setCopied(c => (c === which ? null : c)), 2000)
		} catch {
			// Clipboard refused: the text is on screen and selectable.
		}
	}

	const filled = PUBLIC_REEL_PLATFORMS.filter(p => values[p].trim())

	async function save() {
		if (saving) return
		// The same check the server runs, so a wrong link is named on its field before anything is sent.
		const found: Partial<Record<PublicReelPlatform, string>> = {}
		for (const p of filled) {
			const read = readPublicReelLink(p, values[p])
			if ("error" in read) found[p] = read.error
		}
		setErrors(found)
		setSaveError(null)
		if (Object.keys(found).length > 0) return

		setSaving(true)
		try {
			const res = await fetch(`/api/posts/${postId}/public-links`, {
				body: JSON.stringify({ links: filled.map(platform => ({ platform, url: values[platform] })) }),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
			if (!res.ok) {
				const parsed = PublicLinksErrorSchema.safeParse(await res.json().catch(() => null))
				const fields = parsed.success ? parsed.data.error?.details?.fields : undefined
				if (fields && Object.keys(fields).length > 0) setErrors(fields)
				else
					setSaveError(
						(parsed.success ? parsed.data.error?.message : undefined) ?? "Your links didn't save. Try again.",
					)
				return
			}
			setStep("saved")
		} catch {
			setSaveError("Could not reach the server. Your links are still here. Try again.")
		} finally {
			setSaving(false)
		}
	}

	if (step === "ask")
		return (
			<Modal
				accent="var(--color-violet)"
				eyebrow={eyebrow}
				footer={
					<>
						<Button onClick={onClose} variant="outline">
							Not now
						</Button>
						<Button onClick={() => setStep("links")} variant="solid">
							Yes, post it online <IconArrowRight className="text-base" />
						</Button>
					</>
				}
				labelledBy={titleId}
				onClose={onClose}
				open
				size="md"
			>
				{celebration && (
					<div
						className="sketch mb-5 flex items-start gap-3 rounded-2xl bg-mint px-5 py-4"
						style={{ "--sk-color": "var(--color-teal)", "--sk-radius": "16px" }}
					>
						<IconCheck className="mt-0.5 shrink-0 text-xl text-teal-deep" />
						<div className="min-w-0">
							<p className="text-[0.95rem] leading-snug font-extrabold text-navy">
								Congratulations, your design is submitted!
							</p>
							<p className="mt-1 text-[0.85rem] leading-snug text-navy-soft">
								{celebration.extraHours > 0 ? (
									<>
										Once review is complete and assuming no deflation, you&apos;ll earn{" "}
										<strong className="rounded bg-gold-pale px-1 text-gold-ink">coins</strong> at 5 per hour for your{" "}
										{fmtHours(celebration.extraHours)} past your tier&apos;s funded hours.
									</>
								) : (
									<>It&apos;s with the reviewers now.</>
								)}
							</p>
						</div>
					</div>
				)}
				<ModalTitle id={titleId} sub="You'll earn coins if your post goes viral!">
					Would you like to post your reel online?
				</ModalTitle>
				<p className="hand text-[0.84rem] text-navy-soft">
					Your reel is already on the Doomscroller. This is for Instagram, TikTok, X or YouTube too.
				</p>
			</Modal>
		)

	if (step === "saved")
		return (
			<Modal
				accent="var(--color-teal)"
				eyebrow={eyebrow}
				footer={
					<Button onClick={onClose} variant="solid">
						Done <IconCheck className="text-base" />
					</Button>
				}
				labelledBy={titleId}
				onClose={onClose}
				open
				size="md"
			>
				<ModalTitle
					id={titleId}
					sub={`${filled.length === 1 ? "Your link is" : `All ${filled.length} links are`} saved. If a post takes off, we'll be in touch about your coins.`}
				>
					Good luck going viral
				</ModalTitle>
			</Modal>
		)

	const captionLine = referral.state === "ready" ? `${referral.link} ${PUBLIC_REEL_HASHTAG}` : PUBLIC_REEL_HASHTAG

	return (
		<Modal
			accent="var(--color-violet)"
			eyebrow={eyebrow}
			footer={
				<>
					<p
						className={cx(
							"hand mr-auto min-w-0 flex-1 text-[0.84rem] leading-snug",
							saveError ? "text-coral-deep" : "text-navy-soft",
						)}
						role={saveError ? "alert" : undefined}
					>
						{saveError ?? (filled.length === 0 ? "Paste at least one link to save." : " ")}
					</p>
					<Button disabled={saving} onClick={onClose} variant="outline">
						Skip
					</Button>
					<Button disabled={filled.length === 0 || saving} onClick={() => save()} variant="solid">
						{saving ? "Saving…" : "Save links"}
					</Button>
				</>
			}
			labelledBy={titleId}
			onClose={onClose}
			open
			size="lg"
		>
			{/* First, because it has to be in the caption before the post goes up. */}
			<div
				className="sketch mb-5 rounded-2xl bg-sky-pale px-5 py-4"
				style={{ "--sk-color": "var(--color-sky)", "--sk-radius": "16px" }}
			>
				<p className="label text-navy">Before you post</p>
				<p className="mt-1.5 text-[0.9rem] leading-snug text-navy">
					Put your referral link and <span className="font-bold">{PUBLIC_REEL_HASHTAG}</span> in the caption, so we can
					find your post and anyone who joins from it counts for you.
				</p>
				<div className="mt-3 flex flex-wrap items-center gap-2">
					{referral.state === "loading" ? (
						<p aria-live="polite" className="hand text-[0.84rem] text-navy-soft">
							getting your referral link…
						</p>
					) : referral.state === "error" ? (
						<p className="hand text-[0.84rem] text-coral-deep">
							Your referral link isn&apos;t available right now. The hashtag still counts.
						</p>
					) : (
						<code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-[0.84rem] text-navy">
							{referral.link}
						</code>
					)}
					{referral.state === "ready" && (
						<Button onClick={() => copy(referral.link, "link")} size="sm" variant="outline">
							{copied === "link" ? "Copied!" : "Copy link"}
						</Button>
					)}
					<Button onClick={() => copy(captionLine, "caption")} size="sm" variant="outline">
						{copied === "caption" ? "Copied!" : referral.state === "ready" ? "Copy link + hashtag" : "Copy hashtag"}
					</Button>
				</div>
				{videoUrl && (
					<a
						className="hand mt-3 inline-block text-[0.84rem] text-sky-ink underline decoration-dashed underline-offset-4 hover:text-navy"
						download="half-life-reel.mp4"
						href={attrUrl(videoUrl)}
					>
						save your reel to upload it
					</a>
				)}
			</div>

			<ModalTitle
				id={titleId}
				sub="Paste the link from each post's Share button. Fill in the ones you posted to, and leave the rest blank."
			>
				Where did you post it?
			</ModalTitle>

			<div className="grid gap-4 sm:grid-cols-2">
				{PUBLIC_REEL_PLATFORMS.map(p => {
					const info = PLATFORM_INFO[p]
					const fieldId = `${titleId}-${p}`
					const error = errors[p]
					return (
						<div className="grid gap-1.5" key={p}>
							<label className="label text-violet-deep" htmlFor={fieldId}>
								{info.label}
							</label>
							<input
								aria-describedby={error ? `${fieldId}-error` : undefined}
								aria-invalid={error ? true : undefined}
								autoComplete="off"
								className={cx(
									"block w-full rounded-xl border-2 bg-black/[.02] px-4 py-2.5 text-[0.9rem] text-navy outline-none transition-colors placeholder:text-navy-faint hover:border-line-strong focus:border-violet focus:bg-white",
									error ? "border-coral-deep bg-coral/5" : "border-line",
								)}
								id={fieldId}
								inputMode="url"
								onChange={e => {
									const v = e.target.value
									setValues(prev => ({ ...prev, [p]: v }))
									if (errors[p])
										setErrors(prev => {
											const next = { ...prev }
											delete next[p]
											return next
										})
								}}
								placeholder={info.example}
								spellCheck={false}
								value={values[p]}
							/>
							{error && (
								<p className="text-[0.8rem] leading-snug font-semibold text-coral-deep" id={`${fieldId}-error`}>
									{error}
								</p>
							)}
						</div>
					)
				})}
			</div>
		</Modal>
	)
}
