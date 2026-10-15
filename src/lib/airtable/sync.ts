import "server-only"
import { Phase, PhaseStatus } from "@/app/generated/prisma/enums"
import { fieldKey, toFields, YSWS_REVIEW_STATUS, YSWS_SUBMISSION } from "@/lib/airtable/schema"
import { deleteUnifiedRecords, deleteYswsRecord, updateYswsRecord, writeYswsRecord } from "@/lib/airtable/ysws"
import { bomTotalUsd } from "@/lib/bom-policy"
import { getThemeDef } from "@/lib/config/program"
import { syncHcaProfile } from "@/lib/hca-profile"
import { getHoursBreakdown } from "@/lib/hours"
import { lapseTimelapseUrl } from "@/lib/lapse"
import { round2 } from "@/lib/money"
import { decryptUserPII } from "@/lib/pii"
import prisma from "@/lib/prisma"
import { getProgramSettings } from "@/lib/program"
import { findRepoFile } from "@/lib/repo-checks"
import { repoRefFromLink } from "@/lib/repo-ref"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * One handed-in (themed project, phase) → one row in `YSWS Project Submission`, written at submit as "Pending Review".
 *
 * Half Life has no review page of its own: reviewers work on ari.hackclub.com, straight from this table. So the row is the submission, and everything a reviewer needs to judge it goes into it here – the repo, the hours, the timelapses, the parts money, the address to ship to.
 */

/** YYYY-MM-DD, in UTC – the program's week maths is UTC-anchored too. */
const ymd = (d: Date) => d.toISOString().slice(0, 10)

/**
 * The record id this (project, phase) was last written to, or null.
 *
 * Kept in the audit row each successful write leaves (see trackSideEffect), because the table has no column of ours to find the row by. A later "removed" entry means the row was deleted on unsubmit, so the next submission starts a fresh one.
 */
async function lastRecordId(themeProjectId: string, phase: Phase): Promise<string | null> {
	const rows = await prisma.auditLog.findMany({
		where: { action: "AIRTABLE_SYNC_SUCCESS", targetId: themeProjectId },
		orderBy: { createdAt: "desc" },
		select: { metadata: true },
		take: 50,
	})
	for (const row of rows) {
		const meta = row.metadata as { phase?: string; recordId?: string; removed?: boolean } | null
		if (meta?.phase !== phase) continue
		if (meta.removed) return null
		if (typeof meta.recordId === "string") return meta.recordId
	}
	return null
}

/**
 * The Loops status for a phase in this state.
 *
 * A row is not only written at hand-in: a re-submission and an admin refresh write it again, and both used to stamp "Pending Review" unconditionally – which would put a decided row back to pending and have Loops tell the maker it was never reviewed. Reading the state means the column always says what the phase is, whichever write last touched it. `draft` never has a row at all, and reads as pending only so this is total.
 */
export function reviewStatusFor(status: PhaseStatus): string {
	if (status === PhaseStatus.approved) return YSWS_REVIEW_STATUS.approved
	if (status === PhaseStatus.rejected) return YSWS_REVIEW_STATUS.rejected
	if (status === PhaseStatus.update_requested) return YSWS_REVIEW_STATUS.changesRequested
	return YSWS_REVIEW_STATUS.pending
}

/** The fields for this submission, exactly as the table names them. */
async function fieldsFor(themeProjectId: string, phase: Phase) {
	const project = await prisma.themeProject.findUnique({
		where: { id: themeProjectId },
		include: {
			bomItems: { select: { quantity: true, unitCostUsd: true } },
			workSessions: {
				where: { phase, deletedAt: null },
				select: {
					timelapses: { select: { provider: true, externalId: true, playbackUrl: true, objectKey: true } },
				},
			},
			hackatimeLinks: { where: { phase }, select: { hackatimeProject: true } },
		},
	})
	if (!project) return null

	// Fresh from HCA, so the address a grant ships to is the one on file today rather than the one from whenever they last signed in.
	await syncHcaProfile(project.userId)
	const user = await prisma.user.findUniqueOrThrow({ where: { id: project.userId } })
	const pii = decryptUserPII(user)

	const def = getThemeDef(project.theme)
	const week = phase === Phase.DESIGN ? def.designWeek : def.buildWeek
	const settings = await getProgramSettings()
	const weekStart = new Date(settings.eventStartDate.getTime() + (week - 1) * 7 * 86_400_000)
	const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000)

	const breakdown = await getHoursBreakdown(themeProjectId, phase)
	const bomTotal = bomTotalUsd(project.bomItems, project.bomTaxShippingUsd)

	// A design is judged from its repo; a build from the video of it working – the closing reel the submit sheet asks for, posted under this week's key.
	let playableUrl = project.githubRepo ?? ""
	if (phase === Phase.BUILD) {
		const demo = await prisma.post.findFirst({
			where: {
				userId: project.userId,
				checkpointKey: `w${week}-reel-submission`,
				deletedAt: null,
			},
			orderBy: { createdAt: "desc" },
			select: { objectKey: true },
		})
		playableUrl = publicUrlFor(demo?.objectKey ?? null) ?? playableUrl
	}

	const lapseLinks = project.workSessions
		.flatMap((s) => s.timelapses)
		.map((t) =>
			t.provider === "lapse" && t.externalId
				? lapseTimelapseUrl(t.externalId)
				: (t.playbackUrl ?? publicUrlFor(t.objectKey)),
		)
		.filter((u): u is string => !!u)

	const hackatime = project.hackatimeLinks.map((l) => `${l.hackatimeProject} (${ymd(weekStart)} to ${ymd(weekEnd)})`)

	const [firstName, ...rest] = (user.name ?? "").trim().split(/\s+/)
	const tier = project.tier ?? project.requestedTier
	const journalUrl = await findRepoFile(project.githubRepo, /(^|\/)journal\.md$/i)
	const cover = publicUrlFor(project.coverImageKey)

	const fields = toFields(YSWS_SUBMISSION.fields, {
		codeUrl: project.githubRepo ?? "",
		firstName: firstName ?? "",
		lastName: rest.join(" "),
		email: user.email,
		...(pii.birthday ? { birthday: pii.birthday } : {}),
		slackId: user.slackId ?? "",
		stage: phase === Phase.DESIGN ? "Design" : "Build",
		// The parts are funded once, at design. A build asks for no new money, so its row says $0 rather than repeating the design's request.
		requestedFunding: phase === Phase.DESIGN ? bomTotal : 0,
		hoursSelfReported: round2(breakdown.journalHoursClaimed + breakdown.hackatimeHours),
		playableUrl,
		description: project.description ?? "",
		journalUrl: journalUrl ?? "",
		lapseLinks: lapseLinks.join(", "),
		// A GitHub-only field: for a repo on another forge there is no GitHub username to send, and the repo URL is carried in its own column anyway.
		githubUsername: (() => {
			const ref = repoRefFromLink(project.githubRepo)
			return ref?.forge.id === "github" ? ref.ownerPath : ""
		})(),
		addressLine1: pii.line1 ?? "",
		addressLine2: pii.line2 ?? "",
		city: pii.city ?? "",
		zip: pii.zip ?? "",
		state: pii.state ?? "",
		country: pii.country ?? "",
		hackatimeProjects: hackatime.join(", "),
		hackatimeId: user.hackatimeUserId ?? "",
		projectName: project.title,
		reviewStatus: reviewStatusFor(phase === Phase.DESIGN ? project.designStatus : project.buildStatus),
		tier: tier ? `Tier ${tier}` : "",
	})
	// An attachment is written as a URL Airtable fetches, so the bytes stay in R2 and the base only references them.
	if (cover) fields[fieldKey(YSWS_SUBMISSION.fields.screenshot)] = [{ url: cover }]
	return fields
}

/**
 * Serialize the adopt-or-create decision for one (project, phase).
 *
 * The record id is only known from an audit row written after a successful write, so two callers can arrive before either row exists – the submit `after` hook and the hourly retry job, or an admin's Retry button racing either. Both read "no row yet", both find nothing to adopt, and both POST a
 * new "Pending Review" row into the payout sink. Postgres serializes them
 * here: the loser runs its lookup after the winner's row exists and adopts it instead of creating a second.
 *
 * An advisory xact lock releases with the transaction. The work inside is HTTP, so the transaction gets a generous timeout rather than the default 5 seconds, which would release the lock in the middle of Airtable's own retry backoff.
 */
async function withYswsWriteLock<T>(themeProjectId: string, phase: Phase, fn: () => Promise<T>): Promise<T> {
	return prisma.$transaction(
		async (tx) => {
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ysws:${themeProjectId}:${phase}`}, 0))`
			return fn()
		},
		{ timeout: 120_000, maxWait: 30_000 },
	)
}

/**
 * Write this submission's row: a new one the first time, the same one on a re-submission, so a phase handed in twice is never two rows. The lookup and the write are one critical section, because a create that loses its response and a concurrent create are indistinguishable without it.
 */
export async function syncSubmissionToYsws(
	themeProjectId: string,
	phase: Phase,
): Promise<{ recordId: string; dropped: string[] } | { skipped: string }> {
	const settings = await getProgramSettings()
	if (!settings.airtableSyncEnabled) return { skipped: "sync_disabled" }
	const fields = await fieldsFor(themeProjectId, phase)
	if (!fields) return { skipped: "project_not_found" }
	return withYswsWriteLock(themeProjectId, phase, async () =>
		writeYswsRecord(fields, await lastRecordId(themeProjectId, phase)),
	)
}

/**
 * Move a submission's row on to the decision Ari just reached.
 *
 * Half Life writes the row as "Pending Review" and reviewers work from ari.hackclub.com, but a decision there changes nothing in the base – without this the row sits at "Pending Review" forever, and that column is how Loops tells a maker their work was decided (see YSWS_REVIEW_STATUS in lib/airtable/schema).
 *
 * Best-effort, and only ever after the fact: the review is already committed in Postgres by the time this runs, so a base that is briefly unreachable must not throw and turn a decided submission into one Ari redelivers. No row is not a failure either – a submission written before this sync existed has no record id, and one taken back has none any more.
 */
export async function syncReviewStatusToYsws(
	themeProjectId: string,
	phase: Phase,
	status: string,
): Promise<{ updated: boolean; reason?: string }> {
	const settings = await getProgramSettings()
	if (!settings.airtableSyncEnabled) return { updated: false, reason: "sync_disabled" }
	// The id lives in the audit row each successful write left (see lastRecordId), not in a column of ours.
	const recordId = await lastRecordId(themeProjectId, phase)
	if (!recordId) return { updated: false, reason: "no_row" }
	const result = await updateYswsRecord(recordId, {
		[fieldKey(YSWS_SUBMISSION.fields.reviewStatus)]: status,
	})
	return result.ok ? { updated: true } : { updated: false, reason: result.reason }
}

/** Remove a submission's row, and its unified-base twin, when it is taken back. */
export async function removeSubmissionFromYsws(
	themeProjectId: string,
	phase: Phase,
): Promise<{ deleted: boolean; unifiedDeleted: string[]; skipped?: string }> {
	const recordId = await lastRecordId(themeProjectId, phase)
	if (!recordId) return { deleted: false, unifiedDeleted: [], skipped: "no_row" }
	const local = await deleteYswsRecord(recordId)
	if (!local.unifiedRecordId) return { deleted: local.deleted, unifiedDeleted: [], skipped: local.skipped }
	const unified = await deleteUnifiedRecords([local.unifiedRecordId])
	return { deleted: local.deleted, unifiedDeleted: unified.deleted, skipped: unified.skipped }
}

/**
 * Submissions awaiting review whose row never made it to the table – a write that failed, or one made before this sync existed. Replayed by the retry job and listed on /admin/program.
 */
export async function findUnsyncedSubmissions(): Promise<{ themeProjectId: string; phase: Phase }[]> {
	const pending = await prisma.themeProject.findMany({
		where: {
			deletedAt: null,
			OR: [{ designStatus: PhaseStatus.in_review }, { buildStatus: PhaseStatus.in_review }],
		},
		select: {
			id: true,
			designStatus: true,
			buildStatus: true,
			submissions: { orderBy: { createdAt: "desc" }, select: { phase: true, createdAt: true } },
		},
	})
	if (pending.length === 0) return []

	const synced = await prisma.auditLog.findMany({
		where: { action: "AIRTABLE_SYNC_SUCCESS", targetId: { in: pending.map((p) => p.id) } },
		select: { targetId: true, createdAt: true, metadata: true },
	})

	const out: { themeProjectId: string; phase: Phase }[] = []
	for (const p of pending) {
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const status = phase === Phase.DESIGN ? p.designStatus : p.buildStatus
			if (status !== PhaseStatus.in_review) continue
			const submittedAt = p.submissions.find((s) => s.phase === phase)?.createdAt
			// Written since the latest hand-in counts; an older write was for a submission that has since been taken back and handed in again.
			const written = synced.some((s) => {
				const meta = s.metadata as { phase?: string; recordId?: string } | null
				return (
					s.targetId === p.id &&
					meta?.phase === phase &&
					typeof meta.recordId === "string" &&
					(!submittedAt || s.createdAt >= submittedAt)
				)
			})
			if (!written) out.push({ themeProjectId: p.id, phase })
		}
	}
	return out
}
