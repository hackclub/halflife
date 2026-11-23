"use client"

import { Fragment, useState } from "react"
import { request } from "@/components/review/api"
import { useReviewRuntime } from "@/components/review/runtime"
import { FormErrors, Paper, SafeLink, StatusTag } from "@/components/review/ui"
import type { ReviewRobert, ReviewTelescreen } from "@/lib/review-platform/types"

const STATES: { [_: string]: { label: string; status: string } } = Object.freeze({
	awaiting_outcome: { label: "Waiting on our decision", status: "requested" },
	awaiting_review: { label: "Waiting for fraud review", status: "pending" },
	rejected_fraud: { label: "Rejected for fraud", status: "rejected" },
})

const MODES: { [_: string]: string } = Object.freeze({ cad: "STEP model", pcb: "KiCad board" })

function scoreBand(score: number): { label: string; tone: "bad" | "warn" | "ok" } {
	if (score <= 4) return { label: "Fraud", tone: "bad" }
	if (score <= 7) return { label: "Doubtful", tone: "warn" }
	return { label: "Clean", tone: "ok" }
}

/** Robert rejected the project for fraud, or scored it below clean. */
export function robertSuspicious(robert: ReviewRobert | null): boolean {
	const score = robert?.trustScore ?? null
	return robert?.state === "rejected_fraud" || (score !== null && scoreBand(score).tone !== "ok")
}

/** Spork found a near-identical design, and nobody has marked it a false flag. */
export const sporkFlagged = (telescreen: ReviewTelescreen): boolean =>
	(telescreen.matches.length > 0 || telescreen.robertSporkSameRepo) && telescreen.sporkVerdict?.verdict !== "false_flag"

function stateTag(robert: ReviewRobert) {
	if (robert.state === "decided" && robert.outcomeStatus)
		return <StatusTag label={`Decided: ${robert.outcomeStatus}`} status={robert.outcomeStatus} />
	const state = robert.state ? STATES[robert.state] : undefined
	return state ? (
		<StatusTag label={state.label} status={state.status} />
	) : (
		<StatusTag label="Not queued" status="draft" />
	)
}

interface CardAction {
	busy: boolean
	errors: string[]
	post(url: string, body: object): Promise<void>
}

/** POSTs a card's action and reloads the screen's data, keeping the error to show on the card. */
function useCardAction(): CardAction {
	const runtime = useReviewRuntime()
	const [busy, setBusy] = useState(false)
	const [errors, setErrors] = useState<string[]>([])
	async function post(url: string, body: object): Promise<void> {
		setBusy(true)
		setErrors([])
		try {
			await request(url, { body })
			runtime.refresh()
		} catch (err) {
			setErrors([err instanceof Error ? err.message : "Something went wrong."])
		} finally {
			setBusy(false)
		}
	}
	return { busy, errors, post }
}

/**
 * Fabricate's Robert card: Telescreen's fraud review of the project (see lib/telescreen). Shown only when Robert is suspicious, or when its review has passed and an admin has the outcome to record.
 */
export function RobertCard({
	isAdmin,
	shipId,
	telescreen,
}: {
	isAdmin: boolean
	shipId: string
	telescreen: ReviewTelescreen
}) {
	const runtime = useReviewRuntime()
	const { busy, errors, post } = useCardAction()
	const [reason, setReason] = useState("")
	const { robert } = telescreen
	const suspicious = robertSuspicious(robert)
	const decide = robert?.state === "awaiting_outcome" && isAdmin && !runtime.offline
	if (!robert || !(suspicious || decide)) return null

	const band = robert.trustScore === null ? null : scoreBand(robert.trustScore)
	const url = `/api/reviews/${encodeURIComponent(shipId)}/robert`
	return (
		<Paper
			actions={
				telescreen.robertConfigured && !runtime.offline ? (
					<button
						className="btn btn--outline btn--sm"
						disabled={busy}
						onClick={() => void post(url, { action: "send" })}
						type="button"
					>
						Resend & refresh
					</button>
				) : null
			}
			meta={`${robert.sentBy ? `Sent by ${robert.sentBy}` : "Sent automatically"}${robert.submittedAt ? ` · ${robert.submittedAt}` : ""}`}
			title={suspicious ? "Robert flag" : "Robert"}
			variant={suspicious ? "flag" : undefined}
		>
			<dl className="dl">
				<dt>State</dt>
				<dd>{stateTag(robert)}</dd>
				<dt>Trust score</dt>
				<dd>
					{band ? (
						<span className={`tone-${band.tone}`}>
							{robert.trustScore}/10 · {band.label}
						</span>
					) : (
						"Not scored yet"
					)}
				</dd>
				{robert.reviewNote ? (
					<>
						<dt>Reviewer note</dt>
						<dd className="[white-space:pre-wrap]">{robert.reviewNote}</dd>
					</>
				) : null}
				{robert.reviewerName ? (
					<>
						<dt>Reviewed by</dt>
						<dd>
							{robert.reviewerName}
							{robert.reviewedAt ? ` · ${robert.reviewedAt}` : ""}
						</dd>
					</>
				) : null}
				{robert.reviewFields.map(([key, value]) => (
					<Fragment key={key}>
						<dt>{key}</dt>
						<dd>{typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}</dd>
					</Fragment>
				))}
				<dt>Credited</dt>
				<dd>{robert.creditedHours === null ? "Not credited yet" : `${robert.creditedHours}h`}</dd>
				{robert.outcomeStatus ? (
					<>
						<dt>Outcome</dt>
						<dd>
							{robert.outcomeStatus}
							{robert.outcomeAt ? ` · ${robert.outcomeAt}` : ""}
							{robert.outcomeReason ? ` · ${robert.outcomeReason}` : ""}
						</dd>
					</>
				) : null}
				{robert.conflicts.length > 0 ? (
					<>
						<dt>Conflicts</dt>
						<dd className="tone-warn">{robert.conflicts.join(", ")} point at two different people in Robert</dd>
					</>
				) : null}
				{robert.error ? (
					<>
						<dt>Error</dt>
						<dd className="tone-bad">{robert.error}</dd>
					</>
				) : null}
				<dt>Last synced</dt>
				<dd>{robert.syncedAt ?? "—"}</dd>
			</dl>
			{decide ? (
				<div className="form">
					<p className="field__hint">
						Passed fraud review. Scores of 8 or more on approved projects are approved automatically, and projects we
						reject are rejected automatically.
					</p>
					<textarea
						className="field__textarea"
						onChange={e => setReason(e.target.value)}
						placeholder="Reason (required to reject)"
						value={reason}
					/>
					<div className="form__actions">
						<button
							className="btn btn--solid btn--sm"
							disabled={busy}
							onClick={() => void post(url, { action: "outcome", reason, status: "approved" })}
							type="button"
						>
							Approve in Robert
						</button>
						<button
							className="btn btn--ghost btn--sm btn--reject"
							disabled={busy || !reason.trim()}
							onClick={() => void post(url, { action: "outcome", reason, status: "rejected" })}
							type="button"
						>
							Reject in Robert
						</button>
					</div>
				</div>
			) : null}
			<FormErrors errors={errors} />
		</Paper>
	)
}

/**
 * Fabricate's Spork card: a near-identical KiCad board or STEP model in another repo, from Spork's direct screen and Robert's (see lib/telescreen). Shown only when Spork flagged something; reviewers can mark it real or false, or check again.
 */
export function SporkCard({ shipId, telescreen }: { shipId: string; telescreen: ReviewTelescreen }) {
	const runtime = useReviewRuntime()
	const { busy, errors, post } = useCardAction()
	const [queued, setQueued] = useState(false)
	const { matches, sporkVerdict: verdict } = telescreen
	if (matches.length === 0 && !telescreen.robertSporkSameRepo) return null

	const url = `/api/reviews/${encodeURIComponent(shipId)}/spork`
	return (
		<Paper
			actions={
				runtime.offline ? null : (
					<>
						{(["real", "false_flag"] as const).map(v => (
							<button
								aria-pressed={verdict?.verdict === v}
								className={verdict?.verdict === v ? "btn btn--solid btn--sm" : "btn btn--outline btn--sm"}
								disabled={busy}
								key={v}
								onClick={() => void post(url, { action: "verdict", verdict: verdict?.verdict === v ? null : v })}
								type="button"
							>
								{v === "real" ? "Real flag" : "False flag"}
							</button>
						))}
						{telescreen.sporkConfigured ? (
							<button
								className="btn btn--ghost btn--sm"
								disabled={busy || queued}
								onClick={() => {
									setQueued(true)
									void post(url, { action: "run" })
								}}
								type="button"
							>
								Check again
							</button>
						) : null}
					</>
				)
			}
			meta={
				verdict
					? `Marked ${verdict.verdict === "real" ? "a real flag" : "a false flag"} by ${verdict.by ?? "someone"}${verdict.at ? ` · ${verdict.at}` : ""}`
					: "Near-identical KiCad board or STEP model in another repo."
			}
			title="Spork flag"
			variant="flag"
		>
			{telescreen.robertSporkSameRepo ? (
				<p className="field__hint tone-warn">Another person submitted this exact repo to Robert.</p>
			) : null}
			{matches.length > 0 ? (
				<ul className="notes-list">
					{matches.map(m => (
						<li key={m.url ?? m.repo}>
							<SafeLink href={m.url}>{m.repo}</SafeLink>
							{m.mode ? ` · ${MODES[m.mode] ?? m.mode}` : ""}
							{m.containment === null ? "" : ` · ${Math.round(m.containment * 100)}% of this design`}
						</li>
					))}
				</ul>
			) : null}
			{queued ? (
				<p className="field__hint">Spork check queued. A board takes seconds, a big STEP model a few minutes.</p>
			) : null}
			{telescreen.spork?.error ? (
				<p className="field__hint tone-warn">Last check failed: {telescreen.spork.error}</p>
			) : null}
			<FormErrors errors={errors} />
		</Paper>
	)
}

/** The top bar's tags for a Robert fraud rejection and a standing Spork match, as Fabricate's. */
export function TelescreenTags({ telescreen }: { telescreen: ReviewTelescreen }) {
	return (
		<>
			{telescreen.robert?.state === "rejected_fraud" ? (
				<>
					{" "}
					<StatusTag label="Robert: fraud" status="rejected" />
				</>
			) : null}
			{sporkFlagged(telescreen) ? (
				<>
					{" "}
					<StatusTag label="Spork match" status="flagged" />
				</>
			) : null}
		</>
	)
}

/** Both cards, in Fabricate's order. */
export function TelescreenCards({
	isAdmin,
	shipId,
	telescreen,
}: {
	isAdmin: boolean
	shipId: string
	telescreen: ReviewTelescreen
}) {
	return (
		<>
			<RobertCard isAdmin={isAdmin} shipId={shipId} telescreen={telescreen} />
			<SporkCard shipId={shipId} telescreen={telescreen} />
		</>
	)
}
