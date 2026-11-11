"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { type CSSProperties, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import {
	claim as claimSubmission,
	closeDispute,
	type DecisionBody,
	decide,
	justificationRow,
	overrideDecision,
	releaseQuietly,
	replyToDispute,
	sendDisputeBack,
} from "@/components/review/api"
import { BomSnapshot } from "@/components/review/BomSnapshot"
import { ClaimTimer } from "@/components/review/ClaimTimer"
import { EntryReview, type EntrySave } from "@/components/review/EntryReview"
import { ageTone, formatDollars, formatDuration, formatHours } from "@/components/review/format"
import { useDraft, useStoredToggle, useStoredWidth } from "@/components/review/hooks"
import { ImageGallery } from "@/components/review/ImageGallery"
import { JournalEntryView } from "@/components/review/JournalEntryView"
import { MarkdownEditor } from "@/components/review/MarkdownEditor"
import { ResizeHandle } from "@/components/review/ResizeHandle"
import { ShipTable } from "@/components/review/ShipTable"
import { Field, FormErrors, isSafeUrl, PageHead, Paper, SafeLink, StatusTag, TierTag } from "@/components/review/ui"
import { HardLink } from "@/components/site/HardLink"
import { deflationFor } from "@/lib/airtable/deflation"
import {
	type ApprovalDraft,
	type JustificationRow,
	type JustificationRowMissing,
	previewUnifiedJustification,
} from "@/lib/airtable/unified-justification"
import { round2 } from "@/lib/money"
import { fmtHours } from "@/lib/numbers"
import type { ReviewDetail, ReviewViewer } from "@/lib/review-platform/types"

/** Half Life's redirect to the maker's Telescreen profile (lib/review-platform/telescreen). */
const telescreenHref = (submissionId: string): string => `/api/reviews/${encodeURIComponent(submissionId)}/telescreen`

const FileViewer = lazy(() => import("@/components/review/FileViewer"))

type ReviewTab = "submission" | "deflation" | "files"
type Action = "approve" | "return" | "reject"

/**
 * The review screen: Fabricate's `Admin/Ships/Show`, on Half Life's data.
 *
 * Kept from Fabricate: the three tabs, the claim and its timer, per-entry deflation, the resizable decision panel, drafts that survive a reload, and the c/s/n/d keys. Left out because Half Life has nothing they could run on: every AI check (Robert, Spork, cart, README, follow-up and experience checks, image reuse), the repo checklist, Slack threads, scraps and the early kit, staff notes and flags, review telemetry and the YSWS justification composer – Half Life writes that record itself from the decision, and the panel previews what it will write. Added because Half Life has them and Fabricate does not: Hackatime hours in the hours total, disputes, and the fraud and verification warnings.
 */
export function ShipReview({ detail, viewer }: { detail: ReviewDetail; viewer: ReviewViewer }) {
	return <ShipReviewInner detail={detail} key={detail.ship.id} viewer={viewer} />
}

function ShipReviewInner({ detail, viewer }: { detail: ReviewDetail; viewer: ReviewViewer }) {
	const router = useRouter()
	const { breakdown, entries, maker, project, ship } = detail
	const pending = ship.status === "pending"
	const design = ship.kind === "design"

	const [now, setNow] = useState(() => Date.now())
	const [tab, setTab] = useState<ReviewTab>("submission")
	const [filesOpened, setFilesOpened] = useState(false)
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
			void releaseQuietly(ship.id, true)
		}
	}, [mine, ship.id])

	function showTab(next: ReviewTab): void {
		setTab(next)
		if (next === "files") setFilesOpened(true)
	}

	const claim = useCallback(async () => {
		setErrors([])
		try {
			await claimSubmission(ship.id)
			setNow(Date.now())
			router.refresh()
		} catch (err) {
			setErrors([err instanceof Error ? err.message : "Couldn't claim this review"])
		}
	}, [router, ship.id])

	const skip = useCallback(async () => {
		if (mine) await releaseQuietly(ship.id)
		router.push(detail.nextId ? `/reviews/${detail.nextId}` : "/reviews")
	}, [detail.nextId, mine, router, ship.id])

	const toggleDecision = useCallback(() => setDecisionOpen(!decisionOpen), [decisionOpen, setDecisionOpen])

	// Fabricate's review keys. Ignored while typing, so a "c" in a message is a "c".
	useEffect(() => {
		function onKey(e: KeyboardEvent): void {
			if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
			if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true']")) return
			if (e.key === "c" && canClaim) void claim()
			else if (e.key === "s" && pending) void skip()
			else if (e.key === "n" && detail.nextId) router.push(`/reviews/${detail.nextId}`)
			else if (e.key === "d" && filesView) toggleDecision()
			else return
			e.preventDefault()
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [canClaim, claim, detail.nextId, filesView, pending, router, skip, toggleDecision])

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
							<Link href="/reviews">←</Link> · {project.theme} ·{" "}
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
				<button
					className={tab === "submission" ? "tabs__tab is-active" : "tabs__tab"}
					onClick={() => showTab("submission")}
					type="button"
				>
					Submission
				</button>
				<button
					className={tab === "files" ? "tabs__tab is-active" : "tabs__tab"}
					onClick={() => showTab("files")}
					type="button"
				>
					Files
				</button>
				<button
					className={tab === "deflation" ? "tabs__tab is-active" : "tabs__tab"}
					onClick={() => showTab("deflation")}
					type="button"
				>
					Deflation
				</button>
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
					<div className="timeline">
						{entries.map(entry => (
							<JournalEntryView
								entry={entry}
								key={entry.id}
								reviewer={
									pending && viewer.canReviewHours && entry.countsHours ? (
										<fieldset className="review-lock" disabled={!mine}>
											<EntryReview entry={entry} onSaving={entrySaving} />
										</fieldset>
									) : undefined
								}
							/>
						))}
						{entries.length === 0 ? <p className="field__hint">No journal entries for this phase.</p> : null}
					</div>
				</div>

				<div className="review-layout__main" hidden={tab !== "submission"}>
					<Notices detail={detail} />
					<Paper
						meta={
							ship.claimExpiresAt && (mine || takenBy) ? (
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
							</dd>
							{design ? (
								<>
									<dt>Funding</dt>
									<dd>
										{ship.fundingDeclined
											? "Declined – building with their own parts"
											: [
													project.requestedTier !== null
														? `Tier ${project.requestedTier} requested`
														: "No tier requested",
													ship.requestedBomUsd !== null ? `${formatDollars(ship.requestedBomUsd)} BOM` : null,
													ship.fundingCapUsd !== null ? `capped at ${formatDollars(ship.fundingCapUsd)}` : null,
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
	onActing(acting: boolean): void
	onErrors(errors: string[]): void
	onShowEntry(id: string): void
	savingEntries: number
	takenBy: string | null
	viewer: ReviewViewer
}) {
	const router = useRouter()
	const { project, ship, tiers } = detail
	const design = ship.kind === "design"
	const draft = (field: string): string => `submission:${ship.id}:${field}`
	const [tier, setTier] = useState<string>(String(project.tier ?? project.requestedTier ?? ""))
	const [grant, setGrant] = useDraft(draft("grant"))
	const [hoursOverride, setHoursOverride] = useDraft(draft("hours"))
	const [feedback, setFeedback, clearFeedback] = useDraft(draft("feedback"))
	const [reason, setReason, clearReason] = useDraft(draft("reason"))
	const [technicalFeatures, setTechnicalFeatures, clearTechnicalFeatures] = useDraft(draft("features"))
	const [deflationReason, setDeflationReason, clearDeflationReason] = useDraft(draft("deflation"))
	const airtable = useJustificationRow(ship.id, ship.reviewable)

	// A reviewer may lower a tier or keep it; raising it past what the maker asked for mints parts money, which is MANAGE_CREDIT's call. The decision route enforces this; the select only stops offering what would be refused.
	const tierCap = viewer.canSetGrant ? null : project.requestedTier
	const picked = tiers.find(t => String(t.id) === tier) ?? null
	const grantUsd = grant.trim() === "" ? null : Number(grant)
	const grantInvalid = grantUsd !== null && (!Number.isInteger(grantUsd) || grantUsd < 0 || grantUsd > 500)
	const hoursValue = hoursOverride.trim() === "" ? null : Number(hoursOverride)
	const hoursInvalid = hoursValue !== null && (!Number.isFinite(hoursValue) || hoursValue < 0)
	const funded = design && !ship.fundingDeclined
	const awardUsd = grantUsd ?? picked?.grantUsd ?? null

	// What the approval will freeze (see `finalizeReview`), measured against the claim the row holds – or, until the row is read, the figure hand-in wrote there.
	const approvedHours = hoursValue ?? detail.breakdown.computedTotal
	const claimedHours =
		airtable && "row" in airtable
			? airtable.row.claimedHours
			: round2(detail.breakdown.journalHoursClaimed + detail.breakdown.hackatimeHours)
	const deflation = hoursInvalid ? null : deflationFor(approvedHours, claimedHours)
	const approval: ApprovalDraft = { approvedHours, deflationReason, internalNote: reason, technicalFeatures }

	async function act(action: Action): Promise<void> {
		onErrors([])
		onActing(true)
		const body: DecisionBody =
			action === "approve"
				? {
						...(deflation && deflationReason.trim() ? { deflationReason: deflationReason.trim() } : {}),
						feedback: feedback.trim(),
						...(grantUsd !== null && viewer.canSetGrant ? { grantUsdOverride: grantUsd } : {}),
						...(hoursValue !== null ? { hoursOverride: hoursValue } : {}),
						...(reason.trim() ? { reason: reason.trim() } : {}),
						result: "APPROVED",
						...(technicalFeatures.trim() ? { technicalFeatures: technicalFeatures.trim() } : {}),
						...(design && picked ? { tier: picked.id } : {}),
					}
				: action === "return"
					? { feedback: feedback.trim(), result: "RETURNED", ...(reason.trim() ? { reason: reason.trim() } : {}) }
					: { feedback: feedback.trim(), reason: reason.trim(), result: "REJECTED" }
		try {
			await decide(ship.id, body)
			clearFeedback()
			clearReason()
			clearTechnicalFeatures()
			clearDeflationReason()
			router.push(detail.nextId ? `/reviews/${detail.nextId}` : "/reviews")
			router.refresh()
		} catch (err) {
			onErrors([err instanceof Error ? err.message : "Couldn't record this decision"])
		} finally {
			onActing(false)
		}
	}

	const meta = !ship.reviewable
		? "This phase isn't in review on the project, so it can't be decided."
		: !mine
			? takenBy
				? `${takenBy} is reviewing this ship.`
				: "Claim this review to start deciding."
			: design
				? ship.fundingDeclined
					? "The maker declined funding. Approving sets the tier with no grant."
					: undefined
				: "Approving a build credits the build and checks whether this project reaches a printer."

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
						hint="Required to return or reject. Shown on the project page and sent to the maker."
						id="reason_md"
						label="Message to the maker"
					>
						<MarkdownEditor id="reason_md" onChange={setFeedback} value={feedback} />
					</Field>
					<Field
						hint="Staff only. Required to reject. Kept on the review and in the audit log."
						id="internal_note"
						label="Internal note"
					>
						<textarea
							className="field__textarea"
							id="internal_note"
							onChange={e => setReason(e.target.value)}
							style={{ minHeight: "5rem" }}
							value={reason}
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
					<Field
						hint={
							deflation
								? `${fmtHours(deflation.claimedHours)} claimed, ${fmtHours(deflation.approvedHours)} approved. Staff only. Why the hours came down, for the deflation justification. Left empty, the internal note is used.`
								: "Nothing is cut yet, so this isn't sent. Deflate entries on the Deflation tab first."
						}
						id="deflation_reason"
						label="Deflation reason"
					>
						<textarea
							className="field__textarea field__textarea--line"
							id="deflation_reason"
							onChange={e => setDeflationReason(e.target.value)}
							value={deflationReason}
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
						disabled={!mine || !ship.reviewable || busy || !feedback.trim()}
						onClick={() => void act("return")}
						type="button"
					>
						Return for changes
					</button>
					<button
						className="btn btn--ghost btn--reject"
						disabled={!mine || !ship.reviewable || busy || !feedback.trim() || !reason.trim()}
						onClick={() => void act("reject")}
						type="button"
					>
						Reject
					</button>
				</div>
				{failedEntry !== null || savingEntries > 0 ? (
					<div aria-live="polite" className="form__actions" style={{ flexWrap: "nowrap", whiteSpace: "nowrap" }}>
						{failedEntry !== null ? (
							<>
								<span className="field__error" role="alert">
									A deflation didn&rsquo;t save.
								</span>
								<button className="btn btn--ghost btn--sm" onClick={() => onShowEntry(failedEntry)} type="button">
									Show entry
								</button>
							</>
						) : (
							<span className="field__hint">Waiting for deflation to save…</span>
						)}
					</div>
				) : null}
				<JustificationPreview airtable={airtable} draft={approval} />
			</div>
		</Paper>
	)
}

type JustificationRead = { missing: JustificationRowMissing | null; row: JustificationRow } | { failed: string }

/** The submission's Airtable row – or Half Life's own version of it, when the base can't be read – fetched once per open decision, or null while it loads. */
function useJustificationRow(submissionId: string, reviewable: boolean): JustificationRead | null {
	const [read, setRead] = useState<JustificationRead | null>(null)
	useEffect(() => {
		if (!reviewable) return
		let live = true
		void (async () => {
			let result: JustificationRead
			try {
				result = await justificationRow(submissionId)
			} catch (err) {
				result = { failed: err instanceof Error ? err.message : "Couldn't read the Airtable row" }
			}
			if (live) setRead(result)
		})()
		return () => {
			live = false
		}
	}, [submissionId, reviewable])
	return read
}

/** Why the preview was built from Half Life's own records instead of the Airtable row. */
const MISSING_ROW: { [_ in JustificationRowMissing]: string } = Object.freeze({
	no_row: "Built from Half Life's records: this submission has no Airtable row, so an approval won't write it.",
	not_configured: "Built from Half Life's records: Airtable isn't configured here, so an approval won't write it.",
	sync_disabled: "Built from Half Life's records: Airtable sync is off, so an approval won't write it.",
	unreadable:
		"Built from Half Life's records: the Airtable row couldn't be read. An approval still writes the status, but leaves the justification columns as they are.",
})

/**
 * `Automation - Unified Justification` as an approval would leave it: the base's formula over the row's evidence and what the reviewer has typed (see lib/airtable/unified-justification).
 */
function JustificationPreview({ airtable, draft }: { airtable: JustificationRead | null; draft: ApprovalDraft }) {
	const [open, setOpen] = useStoredToggle("halflife:review-justification-preview")
	const body =
		airtable === null ? (
			<p className="field__hint">Reading the Airtable row…</p>
		) : "failed" in airtable ? (
			<p className="field__error">{airtable.failed}</p>
		) : (
			<>
				<p className="field__hint">
					{airtable.missing
						? MISSING_ROW[airtable.missing]
						: airtable.row.overrideJustification
							? "The row's Override Hours Spent Justification is filled in, so the pipeline sends that instead of anything typed here."
							: "What the unified database receives if you approve now."}
				</p>
				<pre className="field__preview">{previewUnifiedJustification(airtable.row, draft)}</pre>
			</>
		)
	return (
		<details className="field" onToggle={e => setOpen(e.currentTarget.open)} open={open}>
			<summary className="field__label">Unified justification preview</summary>
			{body}
		</details>
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
	const router = useRouter()
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

	async function reverse(action: "unapprove" | "reopen"): Promise<void> {
		const reason = window.prompt(
			action === "unapprove"
				? "Why undo this approval? Credit is taken back to what the maker still holds, and the phase goes back to them for changes. The maker sees this."
				: "Why reopen this rejection? The phase goes back to the maker for changes. The maker sees this.",
		)
		if (!reason?.trim()) return
		onErrors([])
		setBusy(true)
		try {
			await overrideDecision(project.id, {
				action,
				phase: ship.kind === "design" ? "DESIGN" : "BUILD",
				reason: reason.trim(),
			})
			router.refresh()
		} catch (err) {
			onErrors([err instanceof Error ? err.message : "Couldn't undo this decision"])
		} finally {
			setBusy(false)
		}
	}

	return (
		<Paper title="Decision">
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
				<dd style={{ whiteSpace: "pre-wrap" }}>{decision?.feedback || "—"}</dd>
				{viewer.seesRiskFlags ? (
					<>
						<dt>Internal</dt>
						<dd style={{ whiteSpace: "pre-wrap" }}>{decision?.reason || "—"}</dd>
					</>
				) : null}
				<dt>Features</dt>
				<dd style={{ whiteSpace: "pre-wrap" }}>{decision?.technicalFeatures || "—"}</dd>
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
	const router = useRouter()
	const { dispute } = detail
	const [reply, setReply] = useState("")
	const [busy, setBusy] = useState(false)
	const replyField = useRef<HTMLTextAreaElement>(null)
	if (!dispute) return null
	const open = dispute.resolvedAt === null

	async function run(task: () => Promise<unknown>, done?: () => void): Promise<void> {
		onError([])
		setBusy(true)
		try {
			await task()
			done?.()
			router.refresh()
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
				<div className="form" style={{ marginTop: "var(--space-1)" }}>
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
									() => replyToDispute(dispute.id, reply.trim()),
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
							onClick={() => {
								if (window.confirm("Close this dispute and let the decision stand?"))
									void run(() => closeDispute(dispute.id))
							}}
							type="button"
						>
							Close, decision stands
						</button>
						{canSendBack ? (
							<button
								className="btn btn--ghost btn--sm"
								disabled={busy}
								onClick={() => {
									if (window.confirm("Uphold the dispute and send this phase back to the queue?"))
										void run(() => sendDisputeBack(dispute.id))
								}}
								type="button"
							>
								Uphold, send back
							</button>
						) : null}
					</div>
				</div>
			) : null}
		</Paper>
	)
}
