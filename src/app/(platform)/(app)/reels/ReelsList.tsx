"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { IconArrowRight, IconFilm, IconPlus, IconTrash, IconX } from "@/components/platform/icons"
import { PublicReelModal } from "@/components/platform/modals/CheckpointModals"
import { Button, Chip, Panel } from "@/components/platform/ui"
import { fmtDate } from "@/lib/projects"
import { PLATFORM_INFO } from "@/lib/public-reels"
import type { MyReel, MyReelGroup } from "@/lib/queries/reels"
import { PLATFORM_HOME } from "@/lib/routes"

/**
 * The Reels page's list: one section per project, one row per reel, and under each reel the places it has been posted publicly.
 *
 * Adding a link opens the same sheet a reel offers right after it is posted, started on the links – pressing "Add where you posted it" has already said yes. Everything here changes on the server, so every change ends in a refresh rather than a local patch.
 */
export function ReelsList({ groups }: { groups: MyReelGroup[] }) {
	const router = useRouter()
	const [adding, setAdding] = useState<MyReel | null>(null)

	if (groups.length === 0) {
		return (
			<Panel tone="line" radius={20} className="bg-paper px-6 py-14 text-center">
				<p className="text-[1.05rem] font-extrabold text-navy">No reels yet</p>
				<p className="hand mx-auto mt-2 max-w-[44ch] text-[0.9rem] leading-relaxed text-navy-soft">
					reels are posted from the checkpoints on your map: an idea reel to start each design week, then progress reels
					as the hours add up – from five hours in a design week, then every ten, and from two and a half in a build.
				</p>
				<Link
					href={PLATFORM_HOME}
					className="label mt-6 inline-flex items-center gap-1.5 rounded-full border-2 border-line px-4 py-2 text-navy-soft transition-[color,border-color,transform] duration-150 hover:border-navy hover:text-navy active:translate-y-px"
				>
					Go to the map <IconArrowRight className="text-base" />
				</Link>
			</Panel>
		)
	}

	return (
		<>
			{/* `grid-cols-1` rather than a bare grid: the implicit `auto` track takes
          each section's max-content, and a reel row's two nowrap buttons ask for
          more than a phone has – which pushed the whole page wider than the
          viewport. Tailwind's `grid-cols-1` is `minmax(0, 1fr)`, so the track is
          the column and the row wraps instead. */}
			<div className="grid grid-cols-1 gap-8">
				{groups.map(group => (
					<section key={group.project?.id ?? "none"} aria-labelledby={`reels-${group.project?.id ?? "none"}`}>
						<div className="mb-3 flex flex-wrap items-center gap-2">
							<h2 id={`reels-${group.project?.id ?? "none"}`} className="label text-violet-deep">
								{group.project ? (
									<Link
										href={`/projects/${group.project.id}`}
										className="hover:underline hover:decoration-2 hover:underline-offset-4"
									>
										{group.project.title}
									</Link>
								) : (
									"Other reels"
								)}
							</h2>
							{group.project && <Chip tone="muted">{group.project.theme}</Chip>}
						</div>
						<ul className="grid grid-cols-1 gap-3">
							{group.reels.map(reel => (
								<ReelRow key={reel.id} reel={reel} onAdd={() => setAdding(reel)} onChanged={() => router.refresh()} />
							))}
						</ul>
					</section>
				))}
			</div>

			{adding && (
				<PublicReelModal
					postId={adding.id}
					eyebrow={adding.title}
					videoUrl={adding.videoUrl}
					start="links"
					onClose={() => {
						setAdding(null)
						router.refresh()
					}}
				/>
			)}
		</>
	)
}

function ReelRow({ reel, onAdd, onChanged }: { reel: MyReel; onAdd: () => void; onChanged: () => void }) {
	const [removing, setRemoving] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [confirming, setConfirming] = useState(false)
	const [deleting, setDeleting] = useState(false)

	async function deleteReel() {
		setDeleting(true)
		setError(null)
		try {
			const res = await fetch(`/api/posts/${reel.id}`, { method: "DELETE" })
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
				setError(body?.error?.message ?? "That reel didn't delete. Try again.")
				return
			}
			setConfirming(false)
			onChanged()
		} catch {
			setError("That reel didn't delete. Try again.")
		} finally {
			setDeleting(false)
		}
	}

	async function remove(id: string) {
		setRemoving(id)
		setError(null)
		try {
			const res = await fetch(`/api/public-reels/${id}`, { method: "DELETE" })
			if (!res.ok) throw new Error(String(res.status))
			onChanged()
		} catch {
			setError("That link didn't remove. Try again.")
		} finally {
			setRemoving(null)
		}
	}

	return (
		<Panel tone="line" radius={18} as="li" className="flex gap-4 bg-paper p-3.5 sm:gap-5 sm:p-4">
			{/* The reel itself, small and playable. Metadata only until played, so
          a page of reels is not a page of downloads. */}
			<div className="w-[84px] shrink-0 sm:w-[96px]">
				<div className="relative overflow-hidden rounded-xl bg-navy" style={{ aspectRatio: "9 / 16" }}>
					{reel.videoUrl ? (
						// biome-ignore lint/a11y/useMediaCaption: a participant upload, and there is no caption file to point a track at. An empty track is announced as an empty caption, which is worse than none.
						<video
							src={reel.thumbnailUrl ? reel.videoUrl : `${reel.videoUrl}#t=0.1`}
							poster={reel.thumbnailUrl ?? undefined}
							preload="metadata"
							controls
							playsInline
							aria-label={`${reel.title}: ${reel.caption}`}
							className="absolute inset-0 size-full object-cover"
						/>
					) : (
						<div className="absolute inset-0 grid place-items-center">
							<IconFilm className="text-xl text-white/80" />
						</div>
					)}
				</div>
			</div>

			<div className="min-w-0 flex-1">
				<p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
					<span className="text-[0.95rem] font-extrabold text-navy">{reel.title}</span>
					<span className="hand text-[0.84rem] text-navy-soft">{fmtDate(reel.at)}</span>
					{reel.status === "PROCESSING" && <Chip tone="gold">Processing</Chip>}
					{reel.status === "HIDDEN" && <Chip tone="coral">Hidden from the feed</Chip>}
				</p>
				{reel.caption && (
					<p className="mt-1 line-clamp-2 text-[0.9rem] leading-snug [overflow-wrap:anywhere] text-navy-soft">
						{reel.caption}
					</p>
				)}

				<div className="mt-3">
					{reel.links.length > 0 ? (
						<ul className="grid grid-cols-1 gap-1.5" aria-label="Posted publicly on">
							{reel.links.map(link => (
								<li key={link.id} className="flex min-w-0 items-center gap-2">
									<span className="label shrink-0 text-violet-deep">{PLATFORM_INFO[link.platform].label}</span>
									<a
										href={link.url}
										target="_blank"
										rel="noopener noreferrer"
										className="min-w-0 truncate text-[0.86rem] text-navy underline decoration-line-strong decoration-dashed underline-offset-4 transition-colors hover:decoration-violet"
									>
										{link.url.replace(/^https:\/\//, "")}
									</a>
									<button
										type="button"
										onClick={() => remove(link.id)}
										disabled={removing !== null}
										aria-label={
											removing === link.id ? "Removing…" : `Remove the ${PLATFORM_INFO[link.platform].label} link`
										}
										aria-live="polite"
										className="grid size-8 shrink-0 place-items-center rounded-full text-navy-soft transition-colors hover:bg-coral/10 hover:text-coral-deep disabled:opacity-50"
									>
										<IconX className="text-sm" />
									</button>
								</li>
							))}
						</ul>
					) : (
						<p className="hand text-[0.84rem] text-navy-soft">not posted anywhere else yet.</p>
					)}
					{error && (
						<p role="alert" className="hand mt-1 text-[0.84rem] text-coral-deep">
							{error}
						</p>
					)}
					<div className="mt-1.5 -ml-3.5 flex flex-wrap items-center gap-x-1 gap-y-1">
						<Button variant="ghost" size="sm" onClick={onAdd}>
							<IconPlus className="text-sm" />
							<span className="hidden sm:inline">Add where you posted it</span>
							<span className="sm:hidden">Add a link</span>
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setConfirming(true)}
							disabled={reel.deleteLocked !== null || confirming}
							aria-expanded={confirming}
							className="hover:text-coral-deep"
						>
							<IconTrash className="text-sm" /> Delete reel
						</Button>
					</div>
					{/* A disabled control stays where it lives and says why. */}
					{reel.deleteLocked && <p className="hand pl-0.5 text-[0.84rem] text-navy-soft">{reel.deleteLocked}</p>}

					{confirming && (
						// biome-ignore lint/a11y/useSemanticElements: a confirmation box, not a form.
						<div
							role="group"
							aria-labelledby={`delete-${reel.id}`}
							className="mt-2 rounded-xl border-2 border-coral-deep bg-coral/5 px-3.5 py-3"
						>
							<p id={`delete-${reel.id}`} className="text-[0.9rem] leading-snug font-bold text-navy">
								Delete this reel for good?
							</p>
							<p className="mt-1 text-[0.86rem] leading-snug text-navy-soft">
								{reel.reopensCheckpoint
									? `It comes off the platform everywhere, and your ${reel.title.toLowerCase()} checkpoint reopens. Every other checkpoint on your map waits until you re-record it.`
									: "It comes off the platform everywhere. Links to where you posted it go with it."}
							</p>
							<div className="mt-2.5 flex flex-wrap gap-2">
								<Button variant="coral" size="sm" onClick={() => deleteReel()} disabled={deleting}>
									{deleting ? "Deleting…" : "Delete reel"}
								</Button>
								<Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={deleting}>
									Keep it
								</Button>
							</div>
						</div>
					)}
				</div>
			</div>
		</Panel>
	)
}
