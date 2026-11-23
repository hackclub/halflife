"use client"

import type { Route } from "next"
import Link from "next/link"
import {
	type CSSProperties,
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react"
import { AdjustableJournal } from "@/components/review/AdjustHours"
import type { DecisionBody } from "@/components/review/api"
import { BomSnapshot } from "@/components/review/BomSnapshot"
import { ClaimTimer } from "@/components/review/ClaimTimer"
import { EntryReview, type EntrySave } from "@/components/review/EntryReview"
import { ExperienceCheck } from "@/components/review/ExperienceCheck"
import { ageTone, formatDollars, formatDuration, formatHours } from "@/components/review/format"
import { useDraft, useStoredToggle, useStoredWidth } from "@/components/review/hooks"
import { ImageGallery } from "@/components/review/ImageGallery"
import { JournalEntryView } from "@/components/review/JournalEntryView"
import { MarkdownEditor } from "@/components/review/MarkdownEditor"
import { ResizeHandle } from "@/components/review/ResizeHandle"
import { ReviewNotes, shipNoteText } from "@/components/review/ReviewNotes"
import { useReviewRuntime } from "@/components/review/runtime"
import { ShipTable } from "@/components/review/ShipTable"
import { TelescreenCards, TelescreenTags } from "@/components/review/TelescreenCards"
import { Field, FormErrors, isSafeUrl, PageHead, Paper, SafeLink, StatusTag, TierTag } from "@/components/review/ui"
import { useReviewConfirm } from "@/components/review/useReviewConfirm"
import { HardLink } from "@/components/site/HardLink"
import { readStored, writeStored } from "@/lib/browser-state"
import { composeJustification, editBeforeTail, mergeEdits } from "@/lib/review-platform/justification"
import type { ReviewDetail, ReviewEntry, ReviewViewer } from "@/lib/review-platform/types"

/** Half Life's redirect to the maker's Telescreen profile (lib/review-platform/telescreen). */
const telescreenHref = (submissionId: string): Route<`/api/reviews/${string}/telescreen`> =>
	`/api/reviews/${encodeURIComponent(submissionId)}/telescreen`

/** The moment an approval is sent, which its justification is stamped with. A call rather than `new Date()` inline, which reads as impure render to the linter even inside a handler. */
const approvalTime = (): Date => new Date()

/**
 * Where moving on from a ship goes: the next one, which `?claim` has claim itself on arrival (see `useClaimOnArrival`) so a run of reviews needs no "Claim review" between them, or the queue when there is none.
 *
 * `queueQuery` is the queue filters the run started from (see lib/review-platform/queue-filters), carried on so the ship after that is picked within them too.
 */
const nextShipHref = (nextId: string | null, queueQuery: string): Route<`/reviews/${string}?claim${string}`> | Route =>
	nextId ? `/reviews/${nextId}?claim${queueQuery ? `&${queueQuery}` : ""}` : queueHref(queueQuery)

const queueHref = (queueQuery: string): Route => (queueQuery ? `/reviews?${queueQuery}` : "/reviews")

const FileViewer = lazy(() => import("@/components/review/FileViewer"))

export type ReviewTab = "submission" | "deflation" | "files"
type Action = "approve" | "return" | "reject"

/** The tabs in the order they are shown. */
const TAB_LABELS: readonly (readonly [ReviewTab, string])[] = Object.freeze([
	["submission", "Submission"],
	["files", "Files"],
	["deflation", "Deflation"],
])

/**
 * The review screen: Fabricate's `Admin/Ships/Show`, on Half Life's data.
 *
 * Kept from Fabricate: the three tabs, the claim and its timer, per-entry deflation, the resizable decision panel, drafts that survive a reload, and the c/s/n/d keys. Left out because Half Life has nothing they could run on: every AI check but the experience check (cart, README, follow-up, image reuse, and Claude's look at a Spork flag), the repo checklist, Slack threads, scraps and the early kit, and review telemetry. Flags and notes are kept, and take the place of the decision's internal note (see ReviewNotes). The YSWS justification composer is kept: a decision made here writes Fabricate's account to the row (see lib/review-platform/justification). Robert and Spork are kept (see lib/telescreen). Added because Half Life has them and Fabricate does not: Hackatime hours in the hours total, disputes, and the fraud and verification warnings.
 */
export function ShipReview({
	detail,
	queueQuery = "",
	viewer,
}: {
	detail: ReviewDetail
	queueQuery?: string
	viewer: ReviewViewer
}) {
	return (
		<ShipReviewInner
			detail={detail}
			key={detail.ship.id}
			links={{ back: queueHref(queueQuery), next: nextShipHref(detail.nextId, queueQuery) }}
			viewer={viewer}
		/>
	)
}

/**
 * Rewrites the address without a navigation, and tells Next's router about it.
 *
 * Next only picks up a `replaceState` whose state is not its own, so passing `history.state` on would leave the router on the old address: the next `router.refresh()` – a claim runs one – puts that address back, and a refresh that falls back to a full page load loads it.
 */
const replaceAddress = (url: URL): void => history.replaceState(null, "", url)

const subscribeNothing = (): (() => void) => () => undefined

/** The tab the address's `#hash` names, if any. */
const tabFromHash = (): ReviewTab | null => TAB_LABELS.find(([id]) => `#${id}` === location.hash)?.[0] ?? null

/**
 * The open tab, and whether the file viewer has been opened yet (it stays mounted once it has, so going back to it does not re-read the repository).
 *
 * The tab is kept in the address's hash as well, so a reload lands back on it. `router.refresh()` – which every deflation autosave runs – turns into a full page load when the server answers with a different build (any deploy since the page opened) or an error, and without this that load drops the reviewer back on the submission tab mid-edit. It is the hash and not a `?tab=` because Next keys the page by its query: the first refresh after a query change re-renders the page under a new key, remounting the whole screen, which drops the reviewer's focus and scrolls them to the top.
 */
function useReviewTab(): { filesOpened: boolean; showTab(next: ReviewTab): void; tab: ReviewTab } {
	const [picked, setPicked] = useState<ReviewTab | null>(null)
	const [filesPicked, setFilesPicked] = useState(false)
	const fromHash = useSyncExternalStore(subscribeNothing, tabFromHash, () => null)
	const tab = picked ?? fromHash ?? "submission"

	function showTab(next: ReviewTab): void {
		setPicked(next)
		if (next === "files") setFilesPicked(true)
		const url = new URL(location.href)
		url.hash = next === "submission" ? "" : next
		replaceAddress(url)
	}

	return { filesOpened: filesPicked || tab === "files", showTab, tab }
}

/**
 * Arriving from the ship before – a decision, a skip or "n" (see `nextShipHref`) – claims this ship straight away.
 *
 * The flag comes off the address first, so a reload or a second effect run does not claim again. A ship that cannot be claimed – taken in the meantime, decided, or not in review – is passed over for the one after it, carrying the flag on, and replaced in history so going back does not land on it.
 */
function useClaimOnArrival({
	canClaim,
	claim,
	mine,
	nextHref,
}: {
	canClaim: boolean
	claim(): Promise<boolean>
	mine: boolean
	nextHref: string
}): void {
	const runtime = useReviewRuntime()
	useEffect(() => {
		const url = new URL(location.href)
		if (!url.searchParams.has("claim")) return
		url.searchParams.delete("claim")
		replaceAddress(url)
		if (mine) return
		const moveOn = (): void => runtime.replace(nextHref)
		if (!canClaim) {
			moveOn()
			return
		}
		void (async () => {
			if (!(await claim())) moveOn()
		})()
	}, [canClaim, claim, mine, nextHref, runtime])
}

/**
 * Puts the review's scroll box back where it was when `router.refresh()` – which every deflation autosave runs – falls back to a full page load (see `useReviewTab`).
 *
 * The box is `#app-main`, not the window (see "Half Life" in styles/app.css), so the browser's own restoration leaves it at the top. The position is written on pagehide and only read back by a load a few seconds later. Images and players load after mount, so the position is kept trying as the box grows, until it is reached, the reviewer scrolls, or a few seconds pass.
 */
function useKeepScrollAcrossReload(shipId: string): void {
	useEffect(() => {
		const main = document.querySelector<HTMLElement>("#app-main")
		if (!main) return
		const key = `halflife:review-scroll:${shipId}`
		const onHide = (): void => writeStored(key, `${Date.now()}:${main.scrollTop}`)
		window.addEventListener("pagehide", onHide)

		let stop = (): void => {}
		const [at = 0, top = 0] = (readStored(key) ?? "").split(":").map(Number)
		writeStored(key, null)
		if (top > 0 && Date.now() - at < 10_000) {
			const restore = (): void => {
				main.scrollTop = top
				if (main.scrollTop >= top - 1) stop()
			}
			const grow = new ResizeObserver(restore)
			for (const child of main.children) grow.observe(child)
			const timer = window.setTimeout(() => stop(), 5000)
			stop = () => {
				grow.disconnect()
				window.clearTimeout(timer)
				main.removeEventListener("wheel", stop)
				main.removeEventListener("touchstart", stop)
				main.removeEventListener("keydown", stop)
			}
			main.addEventListener("wheel", stop, { passive: true })
			main.addEventListener("touchstart", stop, { passive: true })
			main.addEventListener("keydown", stop)
			restore()
		}
		return () => {
			stop()
			window.removeEventListener("pagehide", onHide)
		}
	}, [shipId])
}

function ShipReviewInner({
	detail,
	links: { back: backHref, next: nextHref },
	viewer,
}: {
	detail: ReviewDetail
	links: { back: ReturnType<typeof queueHref>; next: ReturnType<typeof nextShipHref> }
	viewer: ReviewViewer
}) {
	const runtime = useReviewRuntime()
	const { breakdown, entries, maker, project, ship } = detail
	const pending = ship.status === "pending"
	const design = ship.kind === "design"

	const [now, setNow] = useState(() => Date.now())
	const { filesOpened, showTab, tab } = useReviewTab()
	useKeepScrollAcrossReload(ship.id)
	const [decisionOpen, setDecisionOpen] = useStoredToggle("halflife:review-decision")
	const [decisionWidth, setDecisionWidth] = useStoredWidth("halflife:review-decision-width", 416)
	const [errors, setErrors] = useState<string[]>([])
	const [acting, setActing] = useState(false)
	const [entrySaves, setEntrySaves] = useState<{ [_: string]: EntrySave }>({})

	const claimLive = ship.claimExpiresAt !== null && Date.parse(ship.claimExpiresAt) > now
	const mine = claimLive && ship.claimedByViewer
	const takenBy = pending && claimLive && !ship.claimedByViewer ? ship.claimerName : null
	const canClaim = pending && ship.reviewable && !mine && !takenBy
	const filesView = tab === "files" && project.githubRepo !== null

	const savingEntries = Object.keys(entrySaves)
	const failedEntry = savingEntries.find(id => entrySaves[id] === "error")
	const busy = acting || savingEntries.length > 0
	const entrySaving = useCallback(
		(id: string, state: EntrySave) =>
			setEntrySaves(saves => {
				if ((saves[id] ?? null) === state) return saves
				const next = { ...saves }
				if (state) next[id] = state
				else delete next[id]
				return next
			}),
		[],
	)

	useEffect(() => {
		if (!ship.claimExpiresAt) return
		const id = setTimeout(() => setNow(Date.now()), Math.max(0, Date.parse(ship.claimExpiresAt) - Date.now()))
		return () => clearTimeout(id)
	}, [ship.claimExpiresAt])

	// The decision width on the document as well as the layout: the main column is the review's scroll box (see "Half Life" in styles/app.css) and has to stop where the decision panel starts, but it is the layout's parent, so it cannot read the layout's own value.
	useEffect(() => {
		const root = document.documentElement
		root.style.setProperty("--review-decision", `${decisionWidth}px`)
		return () => void root.style.removeProperty("--review-decision")
	}, [decisionWidth])

	// Fabricate's warm-up: the file viewer starts reading this repository shortly after the page opens, and the next ship's a little later, so the Files tab – and the next review – open on files that are already there. Best-effort: a repository GitHub will not hand over just opens cold.
	useEffect(() => {
		async function prepare(id: string, rank: number): Promise<void> {
			try {
				// biome-ignore lint/correctness/noUndeclaredDependencies: a bundler alias for the vendored file viewer (turbopack.resolveAlias in next.config.ts), not a package
				const hurt = await import("@review/hurt")
				await hurt.preprocessShip(id, rank)
			} catch {
				// Only a warm-up; the tab still loads on demand.
			}
		}
		const timers = [
			...(project.githubRepo ? [window.setTimeout(() => void prepare(ship.id, 0), 1500)] : []),
			...(detail.nextId ? [window.setTimeout(() => void prepare(detail.nextId ?? "", 1), 4000)] : []),
		]
		return () => {
			for (const timer of timers) window.clearTimeout(timer)
		}
	}, [detail.nextId, project.githubRepo, ship.id])

	// Leaving the screen while holding the claim hands it back, as Fabricate does, so the next reviewer is not locked out for the rest of the timer.
	useEffect(() => {
		if (!mine) return
		const path = `/reviews/${ship.id}`
		return () => {
			if (location.pathname === path) return
			void runtime.releaseQuietly(ship.id, true)
		}
	}, [mine, runtime, ship.id])

	const claim = useCallback(async (): Promise<boolean> => {
		setErrors([])
		try {
			await runtime.claim(ship.id)
			setNow(Date.now())
			runtime.refresh()
			return true
		} catch (err) {
			setErrors([err instanceof Error ? err.message : "Couldn't claim this review"])
			return false
		}
	}, [runtime, ship.id])

	useClaimOnArrival({ canClaim, claim, mine, nextHref })

	const skip = useCallback(async () => {
		if (mine) await runtime.releaseQuietly(ship.id)
		runtime.push(nextHref)
	}, [mine, nextHref, runtime, ship.id])

	const toggleDecision = useCallback(() => setDecisionOpen(!decisionOpen), [decisionOpen, setDecisionOpen])

	// Fabricate's review keys. Ignored while typing, so a "c" in a message is a "c".
	useEffect(() => {
		function onKey(e: KeyboardEvent): void {
			if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
			if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true']")) return
			if (e.key === "c" && canClaim) void claim()
			else if (e.key === "s" && pending) void skip()
			else if (e.key === "n" && detail.nextId) runtime.push(nextHref)
			else if (e.key === "d" && filesView) toggleDecision()
			else return
			e.preventDefault()
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [canClaim, claim, detail.nextId, filesView, nextHref, pending, runtime, skip, toggleDecision])

	const claimedSeconds = entries.reduce((sum, e) => sum + e.secondsSpent, 0)
	const countedSeconds = entries.reduce(
		(sum, e) => sum + (e.countsHours ? (e.approvedSeconds ?? e.secondsSpent) : 0),
		0,
	)
	const lapseSeconds = entries.reduce((sum, e) => sum + e.timelapseSeconds, 0)
	const lapseLabel = lapseSeconds > 0 ? ` · ${formatDuration(lapseSeconds)} recorded` : ""

	const tools = (
		<button aria-pressed={decisionOpen} className="review-files__tool" onClick={toggleDecision} type="button">
			{decisionOpen ? "Hide decision" : "Show decision"}
		</button>
	)

	return (
		<>
			<PageHead
				className="page-head--pinned page-head--compact"
				eyebrow={
					<>
						<span style={{ whiteSpace: "nowrap" }}>
							<BackLinks back={backHref} last={detail.lastDecisionId} /> {project.theme} ·{" "}
							{viewer.isAdmin ? <HardLink href={`/admin/users/${maker.id}`}>{maker.name}</HardLink> : maker.name} ·
							submitted{" "}
							<span className={pending ? `tone-${ageTone(ship.ageDays)}` : undefined}>{ship.ageDays}d ago</span>{" "}
							{ship.resubmission ? <StatusTag status="resubmission" /> : null} <StatusTag status={ship.kind} />{" "}
							<StatusTag status={ship.status} />{" "}
							<TierTag requested={project.tier === null} tier={project.tier ?? project.requestedTier} />
						</span>
						{maker.fraudFlagged ? (
							<>
								{" "}
								<StatusTag label="Flagged account" status="flagged" />
							</>
						) : null}
						{maker.verificationStatus !== null && maker.verificationStatus !== "verified" ? (
							<>
								{" "}
								<StatusTag label={`Identity ${maker.verificationStatus}`} status="unverified" />
							</>
						) : null}
						<TelescreenTags telescreen={detail.telescreen} />
						{detail.dispute && !detail.dispute.resolvedAt ? (
							<>
								{" "}
								<StatusTag label="Disputed" status="flagged" />
							</>
						) : null}
					</>
				}
				title={project.title}
			/>

			<nav aria-label="Review sections" className="tabs tabs--review">
				{TAB_LABELS.map(([id, label]) => (
					<button
						className={tab === id ? "tabs__tab is-active" : "tabs__tab"}
						key={id}
						onClick={() => showTab(id)}
						type="button"
					>
						{label}
					</button>
				))}
				<div className="tabs__aside">
					{isSafeUrl(project.repoLink) ? (
						<SafeLink className="btn btn--outline" href={project.repoLink}>
							Repo
						</SafeLink>
					) : null}
					{maker.hasTelescreen ? (
						<a className="btn btn--outline" href={telescreenHref(ship.id)} rel="noopener noreferrer" target="_blank">
							Telescreen
						</a>
					) : null}
					{pending ? (
						<button className="btn btn--outline" onClick={() => void skip()} type="button">
							Skip
						</button>
					) : null}
					{canClaim ? (
						<button className="btn btn--solid" onClick={() => void claim()} type="button">
							Claim review
						</button>
					) : null}
				</div>
			</nav>

			<div
				className={filesView ? "review-layout review-layout--files" : "review-layout"}
				style={{ "--review-decision": `${decisionWidth}px` } satisfies CSSProperties}
			>
				{filesOpened ? (
					<div className="review-layout__main review-files" hidden={tab !== "files"}>
						{project.githubRepo ? (
							<Suspense fallback={<p className="field__hint">Loading the file viewer…</p>}>
								<FileViewer repo={project.githubRepo} submissionId={ship.id} tools={tools} />
							</Suspense>
						) : (
							<Paper title="Files">
								<p>
									The file viewer reads GitHub repositories, and this project&rsquo;s repository link isn&rsquo;t one:{" "}
									<SafeLink href={project.repoLink} />
								</p>
							</Paper>
						)}
					</div>
				) : null}

				<div className="review-layout__main deflation" hidden={tab !== "deflation"}>
					<h2 className="page-head__eyebrow">
						Journal ({entries.length} entries · {formatDuration(claimedSeconds)} claimed ·{" "}
						{formatDuration(countedSeconds)} counted{lapseLabel})
					</h2>
					{pending && !mine ? (
						<p className="field__hint">Claim this review to change what an entry counts as.</p>
					) : null}
					{ship.canAdjustHours ? (
						<AdjustableJournal approvedHours={ship.decision?.hours ?? null} entries={entries} shipId={ship.id} />
					) : (
						<PendingJournal
							editable={pending && viewer.canReviewHours}
							entries={entries}
							mine={mine}
							onSaving={entrySaving}
						/>
					)}
				</div>

				<div className="review-layout__main" hidden={tab !== "submission"}>
					<Notices detail={detail} />
					<TelescreenCards isAdmin={viewer.isAdmin} shipId={ship.id} telescreen={detail.telescreen} />
					<Paper
						meta={
							runtime.offline && mine ? (
								"Reviewing offline: the claim is taken when you send it"
							) : ship.claimExpiresAt && (mine || takenBy) ? (
								<>
									Claimed by {mine ? "you" : takenBy} · <ClaimTimer expiresAt={ship.claimExpiresAt} />
								</>
							) : pending ? (
								"Unclaimed"
							) : (
								`Reviewer: ${ship.decision?.reviewerName ?? "—"}`
							)
						}
						title="Submission"
					>
						{ship.notes ? <p style={{ whiteSpace: "pre-wrap" }}>{ship.notes}</p> : null}
						{project.description ? (
							<p className="field__hint" style={{ whiteSpace: "pre-wrap" }}>
								{project.description}
							</p>
						) : null}
						<dl className="dl" style={{ marginTop: "var(--space-1)" }}>
							<dt>Repository</dt>
							<dd>
								<SafeLink href={project.repoLink} />
							</dd>
							<dt>Theme</dt>
							<dd>{project.theme}</dd>
							<dt>Week</dt>
							<dd>
								{ship.submittedInWeek ?? "—"}
								{ship.onTime ? " · on time" : " · late"} · submitted {ship.submittedAt}
							</dd>
							<dt>Hours</dt>
							<dd>
								{formatHours(breakdown.journalHoursClaimed)} journal claimed · {formatHours(breakdown.journalHours)}{" "}
								counted
								{breakdown.hackatimeHours > 0 ? ` · ${formatHours(breakdown.hackatimeHours)} Hackatime` : ""}
								{lapseLabel} · <strong>{formatHours(breakdown.effectiveHours)} total</strong>
								{detail.ariHours.foreignSeconds > 0 ? (
									<p className="field__hint" style={{ marginTop: 4 }}>
										Ari adds every Lapse clip under this project, including{" "}
										{formatDuration(detail.ariHours.foreignSeconds)} recorded for entries this hand-in does not carry,
										so it reads {formatHours(detail.ariHours.expectedSeconds / 3600)}
										{detail.ariHours.unabsorbedSeconds > 0
											? ` – ${formatDuration(detail.ariHours.unabsorbedSeconds)} more than this total, because the journals could not absorb it. Credit this number, not Ari's.`
											: ", the same total as here."}
									</p>
								) : null}
								{detail.ariHours.unattributedCount > 0 ? (
									<p className="field__hint" style={{ marginTop: 4 }}>
										{detail.ariHours.unattributedCount} of this maker&apos;s clips (
										{formatDuration(detail.ariHours.unattributedSeconds)}) have no Hackatime project on record or on
										Lapse. Ari finds recordings by project, so these cannot appear in its elapsed tile: their time is
										carried by the journal entries that use them instead. Expect Ari&apos;s elapsed figure to be lower
										than the {formatDuration(lapseSeconds)} recorded here, not higher.
									</p>
								) : null}
							</dd>
							{design ? (
								<>
									<dt>Funding</dt>
									<dd>
										{ship.fundingDeclined
											? "Declined – building with their own parts"
											: [
													project.requestedTier === null
														? "No tier requested"
														: `Tier ${project.requestedTier} requested`,
													ship.requestedBomUsd === null ? null : `${formatDollars(ship.requestedBomUsd)} BOM`,
													ship.fundingCapUsd === null ? null : `capped at ${formatDollars(ship.fundingCapUsd)}`,
													ship.partialFundingAccepted ? "accepts partial funding" : null,
												]
													.filter(Boolean)
													.join(" · ")}
									</dd>
								</>
							) : null}
						</dl>
						<ImageGallery urls={ship.imageUrls} />
						{design && detail.bom.length > 0 ? (
							<BomSnapshot lines={detail.bom} taxShippingUsd={detail.bomTaxShippingUsd} />
						) : null}
					</Paper>

					<ReviewNotes detail={detail} viewer={viewer} />

					{detail.dispute ? (
						<DisputePaper canSendBack={viewer.canOverride} detail={detail} onError={setErrors} />
					) : null}

					<Paper title="Earlier ships of this project">
						{detail.history.length > 0 ? (
							<ul className="paper-stack" style={{ gap: "0.75rem" }}>
								{detail.history.map(item => (
									<li key={item.id}>
										<p className="entry__date">
											<Link href={`/reviews/${item.id}`}>
												<StatusTag status={item.kind} />
											</Link>
											{" · "}
											<StatusTag status={item.status} />
											{item.status === "approved" && item.kind === "design" && item.tier !== null
												? ` T${item.tier}`
												: ""}
											{" · "}
											{item.reviewerName ?? "—"} · {item.reviewedAt ?? item.submittedAt}
										</p>
										{item.feedback ? <p style={{ whiteSpace: "pre-wrap" }}>{item.feedback}</p> : null}
										{item.reason ? (
											<p className="field__hint" style={{ whiteSpace: "pre-wrap" }}>
												Internal: {item.reason}
											</p>
										) : null}
									</li>
								))}
							</ul>
						) : (
							<p className="field__hint">Nothing here.</p>
						)}
					</Paper>

					<Paper title="Maker">
						<dl className="dl">
							<dt>Name</dt>
							<dd>{maker.name}</dd>
							<dt>Slack</dt>
							<dd>{maker.slackId ?? "—"}</dd>
							{viewer.seesEmail ? (
								<>
									<dt>Email</dt>
									<dd>{maker.email ?? "—"}</dd>
								</>
							) : null}
							{viewer.seesRiskFlags ? (
								<>
									<dt>Identity</dt>
									<dd>{maker.verificationStatus ?? "—"}</dd>
								</>
							) : null}
						</dl>
					</Paper>

					{runtime.offline ? null : <ExperienceCheck shipId={ship.id} />}

					<Paper title="Other ships by this maker">
						<ShipTable rows={detail.makerShips} showMaker={false} />
					</Paper>
				</div>

				{!filesView || decisionOpen ? (
					<ResizeHandle
						edge="start"
						label="Resize decision panel"
						max={960}
						min={300}
						onResize={setDecisionWidth}
						width={decisionWidth}
					/>
				) : null}
				<aside className="review-layout__aside" hidden={filesView && !decisionOpen}>
					{pending ? (
						<DecisionPanel
							busy={busy}
							detail={detail}
							errors={errors}
							failedEntry={failedEntry ?? null}
							mine={mine}
							nextHref={nextHref}
							onActing={setActing}
							onErrors={setErrors}
							onShowEntry={id => {
								showTab("deflation")
								requestAnimationFrame(() => {
									const input = document.querySelector(`#approved-${id}`)
									input?.scrollIntoView({ block: "center" })
									if (input instanceof HTMLElement) input.focus({ preventScroll: true })
								})
							}}
							savingEntries={savingEntries.length}
							takenBy={takenBy}
							viewer={viewer}
						/>
					) : (
						<DecidedPanel detail={detail} errors={errors} onErrors={setErrors} viewer={viewer} />
					)}
				</aside>
			</div>
		</>
	)
}

/** The journal as a pending ship shows it, each entry's deflation autosaved while the viewer holds the claim. */
function PendingJournal({
	editable,
	entries,
	mine,
	onSaving,
}: {
	editable: boolean
	entries: readonly ReviewEntry[]
	mine: boolean
	onSaving(id: string, state: EntrySave): void
}) {
	return (
		<div className="timeline">
			{entries.map(entry => (
				<JournalEntryView
					entry={entry}
					key={entry.id}
					reviewer={
						editable && entry.countsHours ? (
							<fieldset className="review-lock" disabled={!mine}>
								<EntryReview entry={entry} onSaving={onSaving} />
							</fieldset>
						) : undefined
					}
				/>
			))}
			{entries.length === 0 ? <p className="field__hint">No journal entries for this phase.</p> : null}
		</div>
	)
}

/** Back to the queue, and to the ship the viewer decided last, for when they remember something after moving on. */
function BackLinks({ back, last }: { back: Route; last: string | null }) {
	return (
		<>
			<Link href={back}>←</Link> ·
			{last ? (
				<>
					{" "}
					<Link href={`/reviews/${last}`} title="The ship you decided last">
						↩ last review
					</Link>{" "}
					·
				</>
			) : null}
		</>
	)
}

/** The warnings the console raises, as Fabricate's flagged paper. */
function Notices({ detail }: { detail: ReviewDetail }) {
	const { breakdown, maker } = detail
	const notes: string[] = []
	if (maker.fraudFlagged) notes.push("This account is flagged. Do not approve without an admin.")
	if (maker.verificationStatus !== null && maker.verificationStatus !== "verified")
		notes.push(`Identity status is “${maker.verificationStatus}”, not verified.`)
	if (breakdown.hackatimeStale)
		notes.push(
			"Hackatime hours could not be refreshed and may be stale. Approving is refused until they resolve, unless you set an hours override.",
		)
	if (breakdown.hackatimeOverlapUnknown)
		notes.push(
			"Hackatime overlap with timelapsed entries couldn't be checked, so the Hackatime total may double-count.",
		)
	if (!detail.ship.reviewable && detail.ship.status === "pending")
		notes.push(
			`This project's ${detail.ship.kind} phase is ${detail.project.phaseStatus.replaceAll("_", " ")}, not in review, so it can't be decided here.`,
		)
	if (notes.length === 0) return null
	return (
		<Paper variant="flag">
			<ul className="notes-list">
				{notes.map(note => (
					<li key={note}>{note}</li>
				))}
			</ul>
		</Paper>
	)
}

function DecisionPanel({
	busy,
	detail,
	errors,
	failedEntry,
	mine,
	nextHref,
	onActing,
	onErrors,
	onShowEntry,
	savingEntries,
	takenBy,
	viewer,
}: {
	busy: boolean
	detail: ReviewDetail
	errors: string[]
	failedEntry: string | null
	mine: boolean
	nextHref: string
	onActing(acting: boolean): void
	onErrors(errors: string[]): void
	onShowEntry(id: string): void
	savingEntries: number
	takenBy: string | null
	viewer: ReviewViewer
}) {
	const runtime = useReviewRuntime()
	const { project, ship, tiers } = detail
	const design = ship.kind === "design"
	const draft = (field: string): string => `submission:${ship.id}:${field}`
	const [tier, setTier] = useState<string>(String(project.tier ?? project.requestedTier ?? ""))
	const [grant, setGrant] = useDraft(draft("grant"))
	const [hoursOverride, setHoursOverride] = useDraft(draft("hours"))
	const [feedback, setFeedback, clearFeedback] = useDraft(draft("feedback"))
	const [technicalFeatures, setTechnicalFeatures, clearTechnicalFeatures] = useDraft(draft("features"))
	// The reviewer's edits of the generated justification, kept as the text they edited and the text it was generated from, so later deflation can be merged in under them (see `mergeEdits`).
	const [justificationBase, setJustificationBase, clearJustificationBase] = useDraft(draft("justification-base"))
	const [justificationText, setJustificationText, clearJustificationText] = useDraft(draft("justification"))
	// The setter is unused: it is kept so the state reads as a value and setter pair, which the naming rule requires.
	// biome-ignore lint/correctness/noUnusedVariables: the setter is kept for the naming rule
	const [shownAt, setShownAt] = useState(() => new Date()) // oxlint-disable-line eslint/no-unused-vars
	// A pasted picture is a placeholder in the message until it lands, so nothing is sent while one is on its way.
	const [uploadingImage, setUploadingImage] = useState(false)

	// A reviewer may lower a tier or keep it; raising it past what the maker asked for mints parts money, which is MANAGE_CREDIT's call. The decision route enforces this; the select only stops offering what would be refused.
	const tierCap = viewer.canSetGrant ? null : project.requestedTier
	const picked = tiers.find(t => String(t.id) === tier) ?? null
	const grantUsd = grant.trim() === "" ? null : Number(grant)
	const grantInvalid = grantUsd !== null && (!Number.isInteger(grantUsd) || grantUsd < 0 || grantUsd > 500)
	const hoursValue = hoursOverride.trim() === "" ? null : Number(hoursOverride)
	const hoursInvalid = hoursValue !== null && (!Number.isFinite(hoursValue) || hoursValue < 0)
	const funded = design && !ship.fundingDeclined
	const awardUsd = grantUsd ?? picked?.grantUsd ?? null
	// The decision's internal note is this ship's notes under "Flags & notes".
	const reason = shipNoteText(detail.notes)

	// What the approval will freeze (see `finalizeReview`), against the claim hand-in wrote to the row's `Hours spent (self reported)`.
	const approvedHours = (hoursInvalid ? null : hoursValue) ?? detail.breakdown.computedTotal
	const claimedHours = detail.breakdown.journalHoursClaimed + detail.breakdown.hackatimeHours
	const signOff = `\n\n${detail.justification.signOff}`
	const generatedAt = (approvedAt: Date): string =>
		composeJustification({
			approvedAt,
			approvedHours,
			claimedHours,
			context: detail.justification,
			entries: detail.entries,
			hackatimeHours: detail.breakdown.hackatimeHours,
			reviewer: viewer.displayName,
			technicalFeatures,
		})
	const justificationAt = (approvedAt: Date): string =>
		justificationBase
			? mergeEdits(justificationBase, justificationText, generatedAt(approvedAt))
			: generatedAt(approvedAt)

	function editJustification(field: HTMLTextAreaElement): void {
		const { body, caret } = editBeforeTail(
			`${justificationAt(shownAt)}${signOff}`,
			field.value,
			field.selectionStart,
			signOff,
		)
		setJustificationBase(generatedAt(shownAt))
		setJustificationText(body)
		if (body + signOff !== field.value) requestAnimationFrame(() => field.setSelectionRange(caret, caret))
	}

	function revertJustification(): void {
		clearJustificationBase()
		clearJustificationText()
	}

	async function act(action: Action): Promise<void> {
		onErrors([])
		onActing(true)
		const body: DecisionBody =
			action === "approve"
				? {
						feedback: feedback.trim(),
						...(grantUsd !== null && viewer.canSetGrant ? { grantUsdOverride: grantUsd } : {}),
						...(hoursValue === null ? {} : { hoursOverride: hoursValue }),
						justification: justificationAt(approvalTime()),
						...(reason.trim() ? { reason: reason.trim() } : {}),
						result: "APPROVED",
						...(technicalFeatures.trim() ? { technicalFeatures: technicalFeatures.trim() } : {}),
						...(design && picked ? { tier: picked.id } : {}),
					}
				: action === "return"
					? { feedback: feedback.trim(), result: "RETURNED", ...(reason.trim() ? { reason: reason.trim() } : {}) }
					: { feedback: feedback.trim(), reason: reason.trim(), result: "REJECTED" }
		try {
			await runtime.decide(ship.id, body)
			clearFeedback()
			clearTechnicalFeatures()
			revertJustification()
			runtime.push(nextHref)
			runtime.refresh()
		} catch (err) {
			onErrors([err instanceof Error ? err.message : "Couldn't record this decision"])
		} finally {
			onActing(false)
		}
	}

	const meta = ship.reviewable
		? mine
			? design
				? ship.fundingDeclined
					? "The maker declined funding. Approving sets the tier with no grant."
					: undefined
				: "Approving a build credits the build and checks whether this project reaches a printer."
			: takenBy
				? `${takenBy} is reviewing this ship.`
				: "Claim this review to start deciding."
		: "This phase isn't in review on the project, so it can't be decided."

	return (
		<Paper meta={meta} title="Decision">
			<FormErrors errors={errors} />
			<div className="form">
				<fieldset className="review-lock review-lock--contents" disabled={!mine || !ship.reviewable}>
					{design ? (
						<div className="form__row">
							<Field
								hint={
									picked
										? `${picked.estimate} · ${formatDollars(picked.grantUsd)} grant`
										: "Pick the tier that matches the scope."
								}
								id="tier"
								label="Tier"
							>
								<select className="field__select" id="tier" onChange={e => setTier(e.target.value)} value={tier}>
									<option value="">—</option>
									{tiers.map(t => (
										<option disabled={tierCap !== null && t.id > tierCap} key={t.id} value={t.id}>
											{t.name} · {formatDollars(t.grantUsd)}
											{t.id === project.requestedTier ? " (requested)" : ""}
										</option>
									))}
								</select>
							</Field>
							{viewer.canSetGrant && funded ? (
								<Field
									error={grantInvalid ? "A whole number of dollars, 0 to 500" : null}
									hint="Optional. Overrides the tier's grant."
									id="grant"
									label="Grant amount (USD)"
								>
									<input
										className="field__input field__input--no-spin"
										id="grant"
										inputMode="numeric"
										min={0}
										onChange={e => setGrant(e.target.value)}
										placeholder={picked ? String(picked.grantUsd) : ""}
										step="1"
										type="number"
										value={grant}
									/>
								</Field>
							) : null}
						</div>
					) : null}
					{detail.breakdown.hackatimeStale ? (
						<Field
							error={hoursInvalid ? "Hours must be 0 or more" : null}
							hint={`Hackatime is stale, so the total has to be set by hand. Computed: ${formatHours(detail.breakdown.computedTotal)}.`}
							id="hours_override"
							label="Hours override"
						>
							<input
								className="field__input"
								id="hours_override"
								min={0}
								onChange={e => setHoursOverride(e.target.value)}
								step="0.1"
								type="number"
								value={hoursOverride}
							/>
						</Field>
					) : null}
					<Field
						hint="Required to return or reject. Shown on the project page and sent to the maker. Rejecting also needs a note on this ship under Flags & notes."
						id="reason_md"
						label="Message to the maker"
					>
						<MarkdownEditor
							id="reason_md"
							onChange={setFeedback}
							onUploadingChange={setUploadingImage}
							value={feedback}
						/>
					</Field>
					<Field
						hint="A quick summary of what the maker actually designed: board, chips, sensors, mechanics. A list or a short sentence both work."
						id="technical_features"
						label="Technical features"
					>
						<input
							className="field__input"
							id="technical_features"
							onChange={e => setTechnicalFeatures(e.target.value)}
							value={technicalFeatures}
						/>
					</Field>
				</fieldset>
				<div className="form__actions">
					<button
						className="btn btn--ink btn--approve"
						disabled={
							!mine
							|| !ship.reviewable
							|| busy
							|| uploadingImage
							|| (design && !picked)
							|| grantInvalid
							|| hoursInvalid
							|| (detail.breakdown.hackatimeStale && hoursValue === null)
						}
						onClick={() => void act("approve")}
						type="button"
					>
						Approve
						{design && picked ? ` · Tier ${picked.id}` : ""}
						{funded && awardUsd !== null ? ` · ${formatDollars(awardUsd)} grant` : ""}
					</button>
					<button
						className="btn btn--ghost btn--return"
						disabled={!mine || !ship.reviewable || busy || uploadingImage || !feedback.trim()}
						onClick={() => void act("return")}
						type="button"
					>
						Return for changes
					</button>
					<button
						className="btn btn--ghost btn--reject"
						disabled={!mine || !ship.reviewable || busy || uploadingImage || !feedback.trim() || !reason.trim()}
						onClick={() => void act("reject")}
						type="button"
					>
						Reject
					</button>
				</div>
				{failedEntry !== null || savingEntries > 0 ? (
					<div aria-live="polite" className="form__actions" style={{ flexWrap: "nowrap", whiteSpace: "nowrap" }}>
						{failedEntry === null ? (
							<span className="field__hint">Waiting for deflation to save…</span>
						) : (
							<>
								<span className="field__error" role="alert">
									A deflation didn&rsquo;t save.
								</span>
								<button className="btn btn--ghost btn--sm" onClick={() => onShowEntry(failedEntry)} type="button">
									Show entry
								</button>
							</>
						)}
					</div>
				) : null}
				<fieldset className="review-lock review-lock--contents" disabled={!mine || !ship.reviewable}>
					<Field
						className="field--grow"
						hint={
							justificationBase ? (
								<button className="btn btn--ghost btn--sm" onClick={revertJustification} type="button">
									Revert to generated
								</button>
							) : (
								"Sent to the unified database on approval. Each entry's deflation note is quoted, so say why on the Deflation tab."
							)
						}
						id="justification"
						label="Justification for the YSWS record"
					>
						<textarea
							className="field__textarea"
							id="justification"
							onChange={e => editJustification(e.target)}
							value={`${justificationAt(shownAt)}${signOff}`}
						/>
					</Field>
				</fieldset>
			</div>
		</Paper>
	)
}

function DecidedPanel({
	detail,
	errors,
	onErrors,
	viewer,
}: {
	detail: ReviewDetail
	errors: string[]
	onErrors(errors: string[]): void
	viewer: ReviewViewer
}) {
	const runtime = useReviewRuntime()
	const { project, ship } = detail
	const { decision } = ship
	const [busy, setBusy] = useState(false)
	// Un-approve and reopen are the console's two reversals; a return already leaves the phase with the maker, so there is nothing to undo there. The project's own state decides, because only the latest hand-in's decision is the one standing.
	const undo =
		viewer.canOverride && project.phaseStatus === "approved" && ship.status === "approved"
			? "unapprove"
			: viewer.canOverride && project.phaseStatus === "rejected" && ship.status === "rejected"
				? "reopen"
				: null

	const { confirm, dialog: reverseDialog } = useReviewConfirm()

	async function reverse(action: "unapprove" | "reopen"): Promise<void> {
		const reason = await confirm({
			confirmLabel: action === "unapprove" ? "Undo approval" : "Reopen",
			input: { label: "Reason", placeholder: "Say why, in a sentence" },
			message:
				action === "unapprove"
					? "Credit is taken back to what the maker still holds, and the phase goes back to them for changes. The maker sees this."
					: "The phase goes back to the maker for changes. The maker sees this.",
			title: action === "unapprove" ? "Undo this approval?" : "Reopen this rejection?",
			tone: "danger",
		})
		if (!reason) return
		onErrors([])
		setBusy(true)
		try {
			await runtime.overrideDecision(project.id, {
				action,
				phase: ship.kind === "design" ? "DESIGN" : "BUILD",
				reason: reason.trim(),
			})
			runtime.refresh()
		} catch (err) {
			onErrors([err instanceof Error ? err.message : "Couldn't undo this decision"])
		} finally {
			setBusy(false)
		}
	}

	async function takeBack(): Promise<void> {
		const sure = await confirm({
			confirmLabel: "Take back",
			message:
				ship.status === "approved"
					? "The approval's credit is taken back and the ship goes back into review, claimed by you, with your message ready to edit. The maker has already been told; deciding again tells them again."
					: "The ship goes back into review, claimed by you, with your message ready to edit. The maker has already been told; deciding again tells them again.",
			title: "Take back this decision?",
		})
		// Null on cancel; confirming with no input field gives the empty string.
		if (sure === null) return
		onErrors([])
		setBusy(true)
		try {
			const { feedback } = await runtime.takeBack(ship.id)
			// Into the decision panel's draft (see `useDraft`), so the message only needs the part that was forgotten.
			writeStored(`halflife:review-draft:submission:${ship.id}:feedback`, feedback || null)
			runtime.refresh()
		} catch (err) {
			onErrors([err instanceof Error ? err.message : "Couldn't take this decision back"])
		} finally {
			setBusy(false)
		}
	}

	return (
		<Paper title="Decision">
			{reverseDialog}
			<FormErrors errors={errors} />
			<dl className="dl">
				<dt>Status</dt>
				<dd>
					<StatusTag status={ship.status} /> {decision ? `on ${decision.reviewedAt} by ${decision.reviewerName}` : ""}
				</dd>
				{ship.kind === "design" && ship.status === "approved" ? (
					<>
						<dt>Award</dt>
						<dd>
							Tier {decision?.tier ?? project.tier ?? "—"}
							{decision?.grantUsd !== null && decision?.grantUsd !== undefined
								? ` · ${formatDollars(decision.grantUsd)} grant`
								: ""}
						</dd>
					</>
				) : null}
				{decision?.hours !== null && decision?.hours !== undefined ? (
					<>
						<dt>Hours</dt>
						<dd>{formatHours(decision.hours)}</dd>
					</>
				) : null}
				<dt>Message</dt>
				<dd className="[white-space:pre-wrap]">{decision?.feedback || "—"}</dd>
				<dt>Features</dt>
				<dd className="[white-space:pre-wrap]">{decision?.technicalFeatures || "—"}</dd>
				{decision?.unified && ship.status === "approved" ? (
					<>
						<dt>Unified</dt>
						<dd>
							{decision.unified.sentAt ? `Sent on ${decision.unified.sentAt}` : "Waiting for T2"}
							{viewer.canReviewUnified ? (
								<>
									{" · "}
									<Link href={`/reviews/unified/${decision.unified.reviewId}`}>
										{decision.unified.sentAt ? "Open T2" : "Check at T2"}
									</Link>
								</>
							) : null}
						</dd>
					</>
				) : null}
				{decision?.justification ? (
					<>
						<dt>Justification</dt>
						<dd>
							<details>
								<summary>What the unified database receives</summary>
								<pre className="field__preview">{decision.justification}</pre>
							</details>
						</dd>
					</>
				) : null}
			</dl>
			{undo ? (
				<button
					className="btn btn--outline btn--sm"
					disabled={busy}
					onClick={() => void reverse(undo)}
					style={{ marginTop: "var(--space-1)" }}
					type="button"
				>
					{undo === "unapprove" ? "Undo approval" : "Reopen"}
				</button>
			) : null}
			{ship.canTakeBack ? (
				<button
					className="btn btn--outline btn--sm"
					disabled={busy}
					onClick={() => void takeBack()}
					style={{ marginLeft: undo ? "var(--space-1)" : undefined, marginTop: "var(--space-1)" }}
					title="Put this ship back into review so you can change your decision"
					type="button"
				>
					Take back decision
				</button>
			) : null}
		</Paper>
	)
}

function DisputePaper({
	canSendBack,
	detail,
	onError,
}: {
	canSendBack: boolean
	detail: ReviewDetail
	onError(errors: string[]): void
}) {
	const runtime = useReviewRuntime()
	const { dispute } = detail
	const [reply, setReply] = useState("")
	const [busy, setBusy] = useState(false)
	const replyField = useRef<HTMLTextAreaElement>(null)
	const { confirm, dialog } = useReviewConfirm()
	if (!dispute) return null
	const open = dispute.resolvedAt === null

	/** Asks first, then runs the task: the dispute's two decisive buttons both go through here. */
	async function confirmThen(question: string, task: () => Promise<unknown>): Promise<void> {
		if ((await confirm({ message: "This is recorded in the audit log.", title: question, tone: "danger" })) === null)
			return
		void run(task)
	}

	async function run(task: () => Promise<unknown>, done?: () => void): Promise<void> {
		onError([])
		setBusy(true)
		try {
			await task()
			done?.()
			runtime.refresh()
		} catch (err) {
			onError([err instanceof Error ? err.message : "Couldn't update the dispute"])
		} finally {
			setBusy(false)
		}
	}

	return (
		<Paper
			meta={
				open
					? "Open – the maker is asking for a second look"
					: `Closed${dispute.outcome ? ` · ${dispute.outcome}` : ""}`
			}
			title="Dispute"
			variant={open ? "flag" : undefined}
		>
			<p style={{ whiteSpace: "pre-wrap" }}>{dispute.note}</p>
			{dispute.messages.length > 0 ? (
				<ul className="paper-stack" style={{ gap: "0.5rem", marginTop: "var(--space-1)" }}>
					{dispute.messages.map(message => (
						<li key={message.id}>
							<p className="entry__date">
								{message.fromReviewer ? "Staff" : "Maker"} · {message.author} ·{" "}
								{new Date(message.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
							</p>
							<p style={{ whiteSpace: "pre-wrap" }}>{message.body}</p>
						</li>
					))}
				</ul>
			) : null}
			{open ? (
				<div className="form mt-[var(--space-1)]">
					<textarea
						aria-label="Reply to the maker"
						className="field__textarea"
						onChange={e => setReply(e.target.value)}
						placeholder="Reply to the maker"
						ref={replyField}
						style={{ minHeight: "4rem" }}
						value={reply}
					/>
					<div className="form__actions">
						<button
							className="btn btn--ink btn--sm"
							disabled={busy || !reply.trim()}
							onClick={() =>
								void run(
									() => runtime.replyToDispute(dispute.id, reply.trim()),
									() => setReply(""),
								)
							}
							type="button"
						>
							Reply
						</button>
						<button
							className="btn btn--ghost btn--sm"
							disabled={busy}
							onClick={() =>
								void confirmThen("Close this dispute and let the decision stand?", () =>
									runtime.closeDispute(dispute.id),
								)
							}
							type="button"
						>
							Close, decision stands
						</button>
						{canSendBack ? (
							<button
								className="btn btn--ghost btn--sm"
								disabled={busy}
								onClick={() =>
									void confirmThen("Uphold the dispute and send this phase back to the queue?", () =>
										runtime.sendDisputeBack(dispute.id),
									)
								}
								type="button"
							>
								Uphold, send back
							</button>
						) : null}
					</div>
				</div>
			) : null}
			{dialog}
		</Paper>
	)
}
