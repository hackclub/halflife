import "dotenv/config"
import { and, or } from "@prisma/orm-postgres/orm-client"
import { getAirtableConfig } from "../src/lib/airtable/client"
import { currentReviewColumns } from "../src/lib/airtable/review-columns"
import {
	mirrorReviewDecision,
	recordIdsFromSyncEvents,
	reviewStatusFor,
	syncReviewDecisionToYsws,
} from "../src/lib/airtable/sync"
import { AuditAction, logAudit } from "../src/lib/audit"
import { Phase, PhaseStatus, ReviewResult, type Theme } from "../src/lib/enums"
import db from "../src/lib/prisma8"
import { formatDbTimestamp } from "../src/lib/time"

/**
 * Undo the projects Ari auto-returned for a maker whose Hack Club identity was not yet verified.
 *
 * Ari screens a ship at ingest, and with the program's *Identity screening* toggle on it answered every ship from an unverified maker with an automated request-changes – the maker was told to verify and ship again. The program has since turned that screen off, because verification is moving to a later step rather than the moment a project is handed in, but that change is forward-only: every project already returned that way is still sitting on "needs changes", waiting on a return that should never have been made.
 *
 * This walks the phases still on `update_requested` whose standing decision is that identity return and puts each back in front of reviewers. It mirrors the reopen an Ari requeue performs (see `applyReset` in lib/ari.ts): the phase goes to `in_review`, its reviews are invalidated and its submission reopened, so its state is exactly a hand-in awaiting review again. The one addition is the cleared `ariSubmissionId`: the old ship still carries the changes decision at Ari, and `ari-retry` only resends a hand-in with no ship id, so clearing it is what sends a fresh ship for a real review on the next hourly run.
 *
 * The Airtable row follows the phase, as it does on a requeue: back on "Pending Review" with the identity note cleared. Left on "Changes Requested", the next return would write the value the row already holds, and email-tools forwards only changed values – so the maker would never be told the real decision. Runs from before that mirror existed are healed by `--heal` (see `heal`), which touches only phases this script reopened and that are still in review.
 *
 * Only the identity return is touched. The phase has to be on `update_requested` *and* its latest live review has to be the system return whose note is exactly Ari's identity sentence – which is also what tells it apart from the disallowed-Hackatime auto-return, the one other automated `changes` decision – so a real return, or a project returned again since, is left alone. Read-only unless `--commit`.
 *
 * The return's week (`submissionExtensionUntil`) is left as it stands: extending a maker's window a little costs nothing, and shortening one is not this script's business. Re-running is safe – a phase this reopens is on `in_review` and no longer a candidate.
 *
 * Run where `DATABASE_URL` points at the real database (the Orchard pod, not a dev machine):
 *
 *   bun --conditions=react-server scripts/repair-identity-returns.ts
 *   bun --conditions=react-server scripts/repair-identity-returns.ts --commit
 *   bun --conditions=react-server scripts/repair-identity-returns.ts --heal
 *   bun --conditions=react-server scripts/repair-identity-returns.ts --heal --commit
 */

/** Ari's note on an identity auto-return, verbatim. The rest of the decision is not a reliable signal: the disallowed-Hackatime auto-return is also a system `changes` decision. */
const IDENTITY_NOTE =
	"You haven't verified yourself as a teenager. Verify your identity at https://auth.hackclub.com/ and ship your project again once it's done."

/** Ari attributes every automated decision to this address, so it is what marks a return as the screen's rather than a person's. */
const SYSTEM_REVIEWER_EMAIL = "system@ari"

const commit = process.argv.includes("--commit")
const healOnly = process.argv.includes("--heal")
const limitArg = process.argv.find(arg => arg.startsWith("--limit="))
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined

/** One phase to put back in front of reviewers. */
interface Candidate {
	email: string
	phase: Phase
	reviewId: string
	submissionId: string
	theme: Theme
	themeProjectId: string
	title: string | null
}

/** One phase this script reopened that is still waiting on a fresh review. */
interface HealTarget {
	email: string
	phase: Phase
	recordId: string
	themeProjectId: string
	title: string | null
}

/** The phases still on `update_requested` whose standing decision is the identity auto-return. */
async function findCandidates(): Promise<Candidate[]> {
	const projects = await db.orm.public.ThemeProject.where({ deletedAt: null })
		.where(project =>
			or(project.designStatus.eq(PhaseStatus.update_requested), project.buildStatus.eq(PhaseStatus.update_requested)),
		)
		.select("buildStatus", "designStatus", "id", "theme", "title")
		.include("user", user => user.select("email"))
		.all()
	if (projects.length === 0) return []

	// Every live review on those projects, newest first: the head of each (project, phase) is the decision the phase is standing on, which is what has to be the identity return for this to touch it.
	const reviews = await db.orm.public.SubmissionReview.where({ invalidated: false })
		.where(review => review.submission.some(submission => submission.themeProjectId.in(projects.map(p => p.id))))
		.orderBy(review => review.createdAt.desc())
		.select("feedback", "id", "result", "reviewerEmail")
		.include("submission", submission => submission.select("id", "phase", "themeProjectId"))
		.all()

	const candidates: Candidate[] = []
	for (const project of projects)
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			if ((phase === Phase.DESIGN ? project.designStatus : project.buildStatus) !== PhaseStatus.update_requested)
				continue

			const latest = reviews.find(r => r.submission?.themeProjectId === project.id && r.submission.phase === phase)
			if (!latest?.submission) continue
			if (latest.result !== ReviewResult.RETURNED || latest.reviewerEmail !== SYSTEM_REVIEWER_EMAIL) continue
			if (latest.feedback.trim() !== IDENTITY_NOTE) continue

			candidates.push({
				email: project.user?.email ?? "",
				phase,
				reviewId: latest.id,
				submissionId: latest.submission.id,
				theme: project.theme,
				themeProjectId: project.id,
				title: project.title,
			})
		}

	return candidates
}

/** Put one phase back in review and unbind its ship, so `ari-retry` sends it again for a real review. */
async function repair(candidate: Candidate): Promise<void> {
	await db.transaction(async tx => {
		// The mistaken return is void, and so is any earlier decision on the phase it superseded: a phase going back to review has no standing decision.
		await tx.orm.public.SubmissionReview.where({ invalidated: false })
			.where(review =>
				review.submission.some(submission =>
					and(submission.phase.eq(candidate.phase), submission.themeProjectId.eq(candidate.themeProjectId)),
				),
			)
			.updateAll({ invalidated: true, invalidatedAt: formatDbTimestamp(new Date()) })
		await tx.orm.public.PhaseSubmission.where({ id: candidate.submissionId }).update({
			ariDecision: null,
			ariStatus: "review",
			ariSubmissionId: null,
			resolvedAt: null,
			resolvedResult: null,
		})
		await tx.orm.public.ThemeProject.where({ id: candidate.themeProjectId }).update(
			candidate.phase === Phase.DESIGN
				? { designStatus: PhaseStatus.in_review }
				: { buildStatus: PhaseStatus.in_review },
		)
	})

	await logAudit({
		action: AuditAction.ADMIN_REOPEN_PHASE,
		metadata: {
			after: { status: PhaseStatus.in_review },
			before: { status: PhaseStatus.update_requested },
			phase: candidate.phase,
			reason: "Identity auto-return undone: verification now happens at a later step",
			reviewId: candidate.reviewId,
			source: "repair-identity-returns",
		},
		targetId: candidate.themeProjectId,
		targetType: "ThemeProject",
	})

	// The row follows the phase, exactly as an Ari requeue's does (see `applyReset` in lib/ari.ts). Left on "Changes Requested", the next return writes the value the row already holds, and email-tools forwards only changed values – so the maker would never hear that decision. The note goes with the return it belonged to.
	await mirrorReviewDecision(
		candidate.themeProjectId,
		candidate.phase,
		reviewStatusFor(PhaseStatus.in_review),
		null,
		null,
	)
}

/** The phases this script reopened that are still in review, with the row each one was last written to. */
async function findHealTargets(): Promise<{ targets: HealTarget[]; withoutRow: number }> {
	const projects = await db.orm.public.ThemeProject.where({ deletedAt: null })
		.where(project => or(project.designStatus.eq(PhaseStatus.in_review), project.buildStatus.eq(PhaseStatus.in_review)))
		.select("buildStatus", "designStatus", "id", "title")
		.include("user", user => user.select("email"))
		.all()
	if (projects.length === 0) return { targets: [], withoutRow: 0 }

	// The audit row each repair left names the project and phase, and is how a run from before the row was mirrored is told apart from any other reopen.
	const reopened = new Set<string>()
	const events = await db.orm.public.AuditLog.where({ action: AuditAction.ADMIN_REOPEN_PHASE })
		.where(entry => entry.targetId.in(projects.map(p => p.id)))
		.orderBy(entry => entry.createdAt.desc())
		.select("metadata", "targetId")
		.all()
	for (const event of events) {
		const meta = event.metadata as { phase?: string; source?: string } | null
		if (meta?.source !== "repair-identity-returns" || !meta.phase || !event.targetId) continue
		reopened.add(`${event.targetId}:${meta.phase}`)
	}
	if (reopened.size === 0) return { targets: [], withoutRow: 0 }

	// The record id is not on the project; it is on the audit row each successful write left (see `lastRecordId` in lib/airtable/sync).
	const synced = await db.orm.public.AuditLog.where({ action: AuditAction.AIRTABLE_SYNC_SUCCESS })
		.where(entry => entry.targetId.in(projects.map(p => p.id)))
		.orderBy(entry => entry.createdAt.desc())
		.select("metadata", "targetId")
		.all()
	const records = recordIdsFromSyncEvents(synced)

	const targets: HealTarget[] = []
	let withoutRow = 0
	for (const project of projects)
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			if (!reopened.has(`${project.id}:${phase}`)) continue
			// A repaired phase that has since been decided carries that decision on its row, which is not this script's to undo.
			if ((phase === Phase.DESIGN ? project.designStatus : project.buildStatus) !== PhaseStatus.in_review) continue
			const recordId = records.get(`${project.id}:${phase}`)
			if (!recordId) {
				withoutRow++
				continue
			}
			targets.push({
				email: project.user?.email ?? "",
				phase,
				recordId,
				themeProjectId: project.id,
				title: project.title,
			})
		}
	return { targets, withoutRow }
}

/**
 * Put the rows of phases an older run reopened back on "Pending Review".
 *
 * That run changed Postgres only, so the row stayed on "Changes Requested" while the phase went back in review. The next return then writes the value the row already holds and the Loops poller forwards nothing, so the maker never hears the real decision. Only phases this script reopened, and that are still in review, are touched: a repaired phase that has since been approved or returned is left alone, because its row already carries that decision and rewriting it would email a decision nobody just made.
 */
async function heal(): Promise<void> {
	const config = getAirtableConfig()
	if (!config) {
		console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")
		process.exit(1)
	}

	const { targets, withoutRow } = await findHealTargets()
	console.log(`phases this script reopened and that are still in review: ${targets.length + withoutRow}`)
	if (withoutRow > 0) console.log(`  ${withoutRow} without a known Airtable row; left alone`)
	if (targets.length === 0) return

	const current = await currentReviewColumns(config)
	const pending = reviewStatusFor(PhaseStatus.in_review)
	const stale = targets.filter(t => {
		const row = current.get(t.recordId)
		return !row || row.status !== pending || row.note !== ""
	})
	console.log(`aligned: ${targets.length - stale.length}, to heal: ${stale.length}`)
	for (const target of stale.slice(0, 10)) {
		const row = current.get(target.recordId)
		const before = row ? `${row.status || "(blank)"} / ${JSON.stringify(row.note)}` : "row gone"
		console.log(
			`  ${target.phase}  ${target.title ?? target.themeProjectId} (${target.email}): ${before} -> ${pending}`,
		)
	}
	if (stale.length > 10) console.log(`  …and ${stale.length - 10} more`)
	if (!commit) {
		console.log("Dry run. Pass --heal --commit to put these rows back on Pending Review.")
		return
	}

	let healed = 0
	let gone = 0
	let failed = 0
	for (const target of stale) {
		const mirrored = await syncReviewDecisionToYsws(target.themeProjectId, target.phase, pending, null, null)
		if (mirrored.updated) {
			healed++
			if (mirrored.noteFailed)
				console.error(
					`  ${target.phase}  ${target.title ?? target.themeProjectId} (${target.recordId}) moved but the note failed: ${mirrored.noteFailed}`,
				)
		} else if (mirrored.reason === "no_row" || mirrored.reason === "row_gone") gone++
		else {
			failed++
			console.error(
				`  ${target.phase}  ${target.title ?? target.themeProjectId} (${target.recordId}) failed: ${mirrored.reason}`,
			)
		}
	}
	console.log(`healed: ${healed}, row gone: ${gone}, failed: ${failed}`)
}

async function main() {
	if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
		console.error(`--limit must be a positive integer, got ${limitArg}`)
		process.exit(1)
	}

	if (healOnly) return heal()

	const candidates = await findCandidates()
	const chosen = candidates.slice(0, limit ?? candidates.length)
	console.log(`phases auto-returned for a missing Hack Club identity: ${candidates.length}`)
	console.log(`this run: ${chosen.length}`)

	for (const candidate of chosen)
		console.log(
			`${commit ? "reopen" : "would reopen"} ${candidate.theme}/${candidate.title ?? candidate.themeProjectId} (${candidate.email}): ${candidate.phase.toLowerCase()} -> in review, re-queued to Ari`,
		)

	if (chosen.length === 0) return
	if (!commit) {
		console.log("Dry run. Pass --commit to reopen these.")
		return
	}

	for (const candidate of chosen) await repair(candidate)
	console.log(`reopened ${chosen.length} phase(s). ari-retry sends a fresh ship for each within the hour.`)
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exitCode = 1
} finally {
	await db.close()
}
