import "dotenv/config"
import { Phase, PhaseStatus, ReviewResult, type Theme } from "../src/app/generated/prisma/enums"
import { AuditAction, logAudit } from "../src/lib/audit"
import prisma from "../src/lib/prisma"

/**
 * Undo the projects Ari auto-returned for a maker whose Hack Club identity was not yet verified.
 *
 * Ari screens a ship at ingest, and with the program's *Identity screening* toggle on it answered every ship from an unverified maker with an automated request-changes – the maker was told to verify and ship again. The program has since turned that screen off, because verification is moving to a later step rather than the moment a project is handed in, but that change is forward-only: every project already returned that way is still sitting on "needs changes", waiting on a return that should never have been made.
 *
 * This walks the phases still on `update_requested` whose standing decision is that identity return and puts each back in front of reviewers. It mirrors the reopen an Ari requeue performs (see `applyReset` in lib/ari.ts): the phase goes to `in_review`, its reviews are invalidated and its submission reopened, so its state is exactly a hand-in awaiting review again. The one addition is the cleared `ariSubmissionId`: the old ship still carries the changes decision at Ari, and `ari-retry` only resends a hand-in with no ship id, so clearing it is what sends a fresh ship for a real review on the next hourly run.
 *
 * Only the identity return is touched. The phase has to be on `update_requested` *and* its latest live review has to be the system return whose note is exactly Ari's identity sentence – which is also what tells it apart from the disallowed-Hackatime auto-return, the one other automated `changes` decision – so a real return, or a project returned again since, is left alone. Read-only unless `--commit`.
 *
 * The return's week (`submissionExtensionUntil`) is left as it stands: extending a maker's window a little costs nothing, and shortening one is not this script's business. Re-running is safe – a phase this reopens is on `in_review` and no longer a candidate.
 *
 * Run where `DATABASE_URL` points at the real database (the Orchard pod, not a dev machine):
 *
 *   bun --conditions=react-server scripts/repair-identity-returns.ts
 *   bun --conditions=react-server scripts/repair-identity-returns.ts --commit
 */

/** Ari's note on an identity auto-return, verbatim. The rest of the decision is not a reliable signal: the disallowed-Hackatime auto-return is also a system `changes` decision. */
const IDENTITY_NOTE =
	"You haven't verified yourself as a teenager. Verify your identity at https://auth.hackclub.com/ and ship your project again once it's done."

/** Ari attributes every automated decision to this address, so it is what marks a return as the screen's rather than a person's. */
const SYSTEM_REVIEWER_EMAIL = "system@ari"

const commit = process.argv.includes("--commit")
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

/** The phases still on `update_requested` whose standing decision is the identity auto-return. */
async function findCandidates(): Promise<Candidate[]> {
	const projects = await prisma.themeProject.findMany({
		select: {
			buildStatus: true,
			designStatus: true,
			id: true,
			theme: true,
			title: true,
			user: { select: { email: true } },
		},
		where: {
			deletedAt: null,
			OR: [{ designStatus: PhaseStatus.update_requested }, { buildStatus: PhaseStatus.update_requested }],
		},
	})
	if (projects.length === 0) return []

	// Every live review on those projects, newest first: the head of each (project, phase) is the decision the phase is standing on, which is what has to be the identity return for this to touch it.
	const reviews = await prisma.submissionReview.findMany({
		orderBy: { createdAt: "desc" },
		select: {
			feedback: true,
			id: true,
			result: true,
			reviewerEmail: true,
			submission: { select: { id: true, phase: true, themeProjectId: true } },
		},
		where: { invalidated: false, submission: { themeProjectId: { in: projects.map(p => p.id) } } },
	})

	const candidates: Candidate[] = []
	for (const project of projects)
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			if ((phase === Phase.DESIGN ? project.designStatus : project.buildStatus) !== PhaseStatus.update_requested)
				continue

			const latest = reviews.find(r => r.submission.themeProjectId === project.id && r.submission.phase === phase)
			if (!latest) continue
			if (latest.result !== ReviewResult.RETURNED || latest.reviewerEmail !== SYSTEM_REVIEWER_EMAIL) continue
			if (latest.feedback.trim() !== IDENTITY_NOTE) continue

			candidates.push({
				email: project.user.email,
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
	await prisma.$transaction(async tx => {
		// The mistaken return is void, and so is any earlier decision on the phase it superseded: a phase going back to review has no standing decision.
		await tx.submissionReview.updateMany({
			data: { invalidated: true, invalidatedAt: new Date() },
			where: { invalidated: false, submission: { phase: candidate.phase, themeProjectId: candidate.themeProjectId } },
		})
		await tx.phaseSubmission.update({
			data: { ariDecision: null, ariStatus: "review", ariSubmissionId: null, resolvedAt: null, resolvedResult: null },
			where: { id: candidate.submissionId },
		})
		await tx.themeProject.update({
			data:
				candidate.phase === Phase.DESIGN
					? { designStatus: PhaseStatus.in_review }
					: { buildStatus: PhaseStatus.in_review },
			where: { id: candidate.themeProjectId },
		})
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
}

async function main() {
	if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
		console.error(`--limit must be a positive integer, got ${limitArg}`)
		process.exit(1)
	}

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

main()
	.catch(err => {
		console.error(err)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
