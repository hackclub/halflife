"use client"

import { useEffect, useId, useRef, useState } from "react"
import { IconCamera, IconFilm, IconMic, IconVolume, IconVolumeOff } from "@/components/platform/icons"
import { ReelCapture } from "@/components/platform/reels/ReelCapture"
import { Button, Field, TextInput } from "@/components/platform/ui"
import { attrUrl } from "@/lib/attr-url"
import { useStore } from "@/lib/store"
import type { Checkpoint } from "@/lib/types"
import { readReelDraft, weekName, writeReelDraft } from "./checkpoint-shared"
import { Modal, ModalTitle } from "./Modal"
import { PublicReelModal } from "./PublicReelModal"

export function ReelModal({ checkpoint }: { checkpoint: Checkpoint }) {
	const { setOpenCheckpoint, postReel, stateOf, weekOf } = useStore()
	const week = weekOf(checkpoint.weekId)
	const { done } = stateOf(checkpoint.id)
	// A reel draft is restored once, when the sheet opens, and never changes while it is open – so it is a value to read, not one to set.
	// oxlint-disable-next-line react/hook-use-state
	const [draft] = useState(() => readReelDraft(checkpoint.id))
	const [clip, setClip] = useState<string | null>(draft?.clip ?? null)
	// What the preview plays: a blob URL for a file picked on this machine, the bucket's URL for one filmed on the phone or restored from a draft.
	const [previewUrl, setPreviewUrl] = useState<string | null>(draft?.url ?? null)
	// Kept apart from the preview because a blob URL cannot outlive the page, so it is never what a draft remembers.
	const [clipUrl, setClipUrl] = useState<string | null>(draft?.url ?? null)
	const [caption, setCaption] = useState(draft?.caption ?? "")

	// `autoPlay` alone is a request the browser may defer (a tab that was not focused when the clip arrived, say), so the preview asks once more itself. Sound starts off: autoplay with audio is refused, so the preview opens muted and the speaker toggle below is the gesture that allows it.
	const previewVideo = useRef<HTMLVideoElement>(null)
	const [muted, setMuted] = useState(true)
	useEffect(() => {
		const video = previewVideo.current
		if (!video) return
		// The `muted` attribute only sets the initial state – React re-renders do not move the property after mount – so the toggle writes it here.
		video.muted = muted
		void (async () => {
			try {
				await video.play()
			} catch {
				// Autoplay refuses before a gesture; the play button below is the fallback.
			}
		})()
	}, [previewUrl, muted])

	// A blob URL holds the whole video in memory until it is revoked.
	useEffect(
		() => () => {
			if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl)
		},
		[previewUrl],
	)

	function capture(key: string | null, url?: string | null) {
		setClip(key)
		setPreviewUrl(url ?? null)
		setClipUrl(url && !url.startsWith("blob:") ? url : null)
		setMuted(true)
	}

	// Posting waits for the server, so there is a post to hang public links on and so a failure says so instead of closing on a reel that never landed.
	const [posting, setPosting] = useState(false)
	const [postError, setPostError] = useState<string | null>(null)
	const [postedId, setPostedId] = useState<string | null>(null)

	async function post() {
		if (!clip || posting) return
		setPosting(true)
		setPostError(null)
		const { postId, error } = await postReel(checkpoint.id, caption.trim(), clip)
		setPosting(false)
		if (error) {
			setPostError(error)
			return
		}
		writeReelDraft(checkpoint.id, null)
		setPostedId(postId ?? null)
	}

	// A finished reel asks before it opens the recorder: the checkpoint is done, and another reel is an extra, so reopening one should say that rather than look like the checkpoint asking for its reel again. A draft already under way for it means that question was answered last time.
	const [again, setAgain] = useState(!done || draft !== null)
	const titleId = useId()
	const captionLength = caption.trim().length
	const captionReady = captionLength >= 8
	const captionBlocker = captionReady
		? null
		: `Caption needs ${8 - captionLength} more character${8 - captionLength === 1 ? "" : "s"} (${captionLength}/8).`
	const postBlocker = !clip ? "Add a clip before posting this reel." : captionBlocker

	// Posted: the same sheet now asks whether it is going anywhere else. The clip's URL comes along so it can be saved and uploaded there.
	if (postedId)
		return (
			<PublicReelModal
				eyebrow={`${weekName(week)} · ${checkpoint.title}`}
				onClose={() => setOpenCheckpoint(null)}
				postId={postedId}
				videoUrl={previewUrl}
			/>
		)

	if (!again)
		return (
			<Modal
				accent="var(--color-teal)"
				eyebrow={`${weekName(week)} · ${checkpoint.title}`}
				footer={
					<>
						<Button onClick={() => setOpenCheckpoint(null)} variant="outline">
							Not now
						</Button>
						<Button onClick={() => setAgain(true)} variant="solid">
							Post another reel <IconFilm className="text-base" />
						</Button>
					</>
				}
				labelledBy={titleId}
				onClose={() => setOpenCheckpoint(null)}
				open
				size="md"
			>
				<ModalTitle
					id={titleId}
					sub="Your first one will stay up, your new one will be added to your project's timeline. If you want to delete the reel, go to the Reels Manager tab!"
				>
					You&apos;ve completed this checkpoint! Would you like to post another reel?
				</ModalTitle>
			</Modal>
		)

	return (
		<Modal
			accent="var(--color-violet)"
			eyebrow={`${weekName(week)} · ${checkpoint.title}`}
			footer={
				<>
					{postError ? (
						<p className="hand mr-auto min-w-0 flex-1 text-[0.84rem] leading-snug text-coral-deep" role="alert">
							{postError}
						</p>
					) : postBlocker ? (
						<p
							className="hand mr-auto min-w-0 flex-1 text-[0.84rem] leading-snug text-coral-deep"
							id="reel-caption-blocker"
							role="status"
						>
							{postBlocker}
						</p>
					) : (
						<p className="hand hidden text-[0.78rem] text-navy-soft sm:block">
							Reels post straight to the Doomscroller.
						</p>
					)}
					<Button
						onClick={() => {
							writeReelDraft(checkpoint.id, clip || caption.trim() ? { caption, clip: clip ?? "", url: clipUrl } : null)
							setOpenCheckpoint(null)
						}}
						variant="outline"
					>
						{/* On a finished checkpoint with nothing started there is no draft to keep – it is just the answer to "another one?" */}
						{done && !clip && !caption.trim() ? "Not now" : "Save draft"}
					</Button>
					<Button disabled={Boolean(postBlocker) || posting} onClick={() => post()} variant="solid">
						{posting ? "Posting…" : done ? "Post another reel" : "Post reel"} <IconFilm className="text-base" />
					</Button>
				</>
			}
			onClose={() => setOpenCheckpoint(null)}
			open
			size="lg"
		>
			{/* Past the question: this is an extra reel, not the checkpoint's own. */}
			{done ? (
				<ModalTitle sub="Your first one stays up, and this one joins it on your project.">Post another reel</ModalTitle>
			) : (
				<ModalTitle sub={checkpoint.blurb}>Make your {checkpoint.title.toLowerCase()}</ModalTitle>
			)}

			<div className="grid gap-6 md:grid-cols-[1fr_200px]">
				<div className="grid gap-4">
					<div
						className="sketch rounded-2xl bg-sky-pale px-5 py-4"
						style={{ "--sk-color": "var(--color-sky)", "--sk-radius": "16px" }}
					>
						<p className="label flex items-center gap-2 text-sky-ink">
							<IconMic className="text-base" /> What to film
						</p>
						<p className="mt-1.5 text-[0.92rem] leading-snug text-navy">{checkpoint.reelBrief}</p>
					</div>

					<div className="grid gap-2">
						<p className="label flex items-center gap-2 text-navy-soft">
							<IconCamera className="text-base" /> Your clip
						</p>
						<p className="text-[0.88rem] leading-snug text-navy-soft">
							Vertical, 30 to 60 seconds, filmed on whatever you have. No editing required.
						</p>
						<ReelCapture objectKey={clip} onCaptured={capture} />
					</div>

					<Field
						hint={captionReady ? "One line. Say what changed." : `At least 8 characters (${captionLength}/8).`}
						id="reel-caption"
						label="Caption"
					>
						<TextInput
							aria-describedby={postBlocker ? "reel-caption-blocker" : undefined}
							aria-invalid={!captionReady || undefined}
							id="reel-caption"
							onChange={e => setCaption(e.target.value)}
							placeholder="routed the whole board without a single ratline left"
							value={caption}
						/>
					</Field>
				</div>

				<div className="mx-auto w-45 md:w-full">
					<p className="label mb-2 text-navy-soft">Preview</p>
					<div className="relative overflow-hidden rounded-xl" style={{ aspectRatio: "9 / 16" }}>
						{clip ? (
							<>
								{/* The clip itself, looping the way the Doomscroller will show it. Without a URL (a draft on a deployment with no public bucket URL) it says so rather than standing a stock illustration in for someone's footage. */}
								{previewUrl ? (
									<>
										<video
											aria-label="Preview of your reel"
											autoPlay
											className="absolute inset-0 size-full bg-navy object-cover"
											key={previewUrl}
											loop
											muted
											playsInline
											ref={previewVideo}
											src={attrUrl(previewUrl)}
										/>
										<button
											aria-label={muted ? "Unmute the preview" : "Mute the preview"}
											aria-pressed={!muted}
											className="absolute top-2 right-2 z-10 grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
											onClick={() => setMuted(m => !m)}
											type="button"
										>
											{muted ? <IconVolumeOff className="text-lg" /> : <IconVolume className="text-lg" />}
										</button>
									</>
								) : (
									<div className="absolute inset-0 grid place-items-center bg-navy px-4 text-center">
										<p className="flex flex-col items-center gap-2 text-[0.78rem] leading-snug text-white/85">
											<IconFilm className="text-2xl text-white" />
											Uploaded. The preview plays once it is posted.
										</p>
									</div>
								)}
								<div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2.5 pt-8">
									<p className="text-[0.7rem] leading-snug font-semibold text-white">
										{caption || "your caption here"}
									</p>
								</div>
							</>
						) : (
							<div
								className="sketch grid size-full place-items-center rounded-xl bg-white px-3 text-center"
								style={{ "--sk-radius": "12px" }}
							>
								<p className="hand text-[0.78rem] leading-snug text-navy-soft">nothing here yet</p>
							</div>
						)}
					</div>
				</div>
			</div>
		</Modal>
	)
}
