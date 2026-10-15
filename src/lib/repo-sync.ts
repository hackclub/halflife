import "server-only"
import { Theme } from "@/app/generated/prisma/enums"
import { AuditAction, logAudit } from "@/lib/audit"
import { listBom } from "@/lib/bom"
import { getThemeDef, WARMUP_WEEK_ID } from "@/lib/config/program"
import { HttpError } from "@/lib/errors"
import { ALL_FORGES } from "@/lib/forge"
import { commitFiles, defaultBranchOf, forgeCredentials, type WrittenFile } from "@/lib/forge-write"
import prisma from "@/lib/prisma"
import { parseRepoRef, repoRefFromLink, repoRefToUrl } from "@/lib/repo-ref"
import {
	type BomLineForFile,
	type JournalEntry,
	legacyBomDeletion,
	renderBom,
	renderJournal,
} from "@/lib/repo-sync-files"

/**
 * The repo sync: what actually runs when a project's devlogs or parts list need to land in its repository.
 *
 * Three things this module is careful about:
 *
 * 1. **It never blocks the write that asked for it.** A journal entry is saved by the person waiting on it; the commit is scheduled with `after()`, so a slow GitHub never shows up as a slow Save button. `scheduleRepoSync` is the only entry point the writers call.
 * 2. **A burst of writes becomes one commit.** `repoSyncQueuedAt` is stamped by any write that lands while a run is in flight, and the run picks it up and goes again rather than each write starting its own commit. `syncProject` loops until the flag stops moving.
 * 3. **Failure is recorded where a person will see it.** The project's `repoSyncError` is what its page renders; the run row and the audit entry are what staff read.
 *
 * Which forge a repo lives on is read from the repo link, never chosen per project or per user: `repoRefFromLink` resolves the host to a forge, and everything below it – credentials, the branch read, the commit – takes that forge rather than assuming GitHub. The forge side is lib/forge-write; the file contents are lib/repo-sync-files.
 */

/** Debounce: the shortest gap between a write and its commit being started. */
export const SYNC_DEBOUNCE_MS = 2_000

/** How long a scheduled run waits for the in-flight one to finish. */
const QUEUE_POLL_MS = 1_500

/** Give up waiting for a stuck run; the next write will start a fresh one. */
const QUEUE_MAX_WAIT_MS = 60_000

/**
 * In-process note of which projects currently have a run going.
 *
 * Not a lock – a second process is a second map, and the GitHub ref update is itself guarded, so two runs racing is a lost commit rather than a corrupt repo. This exists to keep one process from stacking runs on the same project, which is the common case (one maker editing one project).
 */
const inFlight = new Set<string>()

/**
 * Ask for this project's repo to be brought up to date, after the current response has gone out. Safe to call from anywhere, including a route's `after()` hook: it never throws and never waits on GitHub.
 */
export async function scheduleRepoSync(themeProjectId: string): Promise<void> {
	// The read is cheap and decides everything: a project with the sync off is the common case, and there is no reason to schedule anything for it. The global switch is checked here too, so a staff kill switch stops new work without waiting for each project row.
	const [project, program] = await Promise.all([
		prisma.themeProject.findUnique({
			where: { id: themeProjectId },
			select: { repoSyncEnabled: true, repoSyncQueuedAt: true },
		}),
		prisma.programSettings.findUnique({ where: { id: "singleton" }, select: { repoSyncEnabled: true } }),
	])
	if (!project?.repoSyncEnabled || program?.repoSyncEnabled === false) return

	// Stamp the request, then run. The stamp is what a run already in flight reads to know it should go again.
	await prisma.themeProject.updateMany({
		where: { id: themeProjectId },
		data: { repoSyncQueuedAt: new Date() },
	})
	if (inFlight.has(themeProjectId)) return

	runProjectSync(themeProjectId, false).catch(err =>
		console.error(`[repo-sync] unhandled failure for ${themeProjectId}:`, err),
	)
}

/**
 * Run the sync for one project to completion, draining anything queued while it ran. Resolves when there is nothing left to do, so the `after()` callback that called it is not cut short.
 *
 * `force` is the first write of an enable: it ignores the "is the sync on" gate, because at that instant it is not on yet – it is the commit that decides whether it can be. Everything else cooperates with the gate.
 */
export async function runProjectSync(themeProjectId: string, manual: boolean, force = false): Promise<WrittenFile[]> {
	// Wait out another run on the same project rather than racing it for the ref.
	if (inFlight.has(themeProjectId)) await waitForFree(themeProjectId)

	inFlight.add(themeProjectId)
	let written: WrittenFile[] = []
	// A local rather than the parameter: the first pass is the manual one, and every pass after it is an ordinary one.
	let runManual = manual
	try {
		// A loop, not an `if`: a write that lands during this run stamps the queue flag, and the correct response is one more run – not leaving it for a sync that may never come.
		for (let pass = 0; pass < 5; pass++) {
			const queuedAt = await claimQueued(themeProjectId)
			if (queuedAt === null && !runManual && !force) break
			written = await syncOnce(themeProjectId, runManual || pass > 0, force && pass === 0)
			runManual = false
			const stillQueued = await prisma.themeProject.findUnique({
				where: { id: themeProjectId },
				select: { repoSyncQueuedAt: true },
			})
			// Anything queued AFTER the claim means another write arrived while this pass ran.
			const queueTime = stillQueued?.repoSyncQueuedAt
			if (queueTime === null || queueTime === undefined) break
			if (queuedAt !== null && queueTime <= queuedAt) break
		}
	} finally {
		inFlight.delete(themeProjectId)
	}

	// A write can land between the last queue read and the delete above: it stamps the flag, finds the project still in flight, and returns, so nobody would ever claim it. Claiming here closes that window – and if this run loses the claim to another process, that process is doing the work instead.
	if (await claimQueued(themeProjectId)) {
		runProjectSync(themeProjectId, false).catch(err =>
			console.error(`[repo-sync] straggler sync failed for ${themeProjectId}:`, err),
		)
	}

	return written
}

/**
 * Take the queued flag for this run.
 *
 * Conditional on it still being the value we read, so two runs cannot both claim the same request. Returns the claimed timestamp, or null when there was nothing waiting.
 */
async function claimQueued(themeProjectId: string): Promise<Date | null> {
	const now = await prisma.themeProject.findUnique({
		where: { id: themeProjectId },
		select: { repoSyncQueuedAt: true },
	})
	const queuedAt = now?.repoSyncQueuedAt
	if (!queuedAt) return null
	const claimed = await prisma.themeProject.updateMany({
		where: { id: themeProjectId, repoSyncQueuedAt: queuedAt },
		data: { repoSyncQueuedAt: null },
	})
	return claimed.count > 0 ? queuedAt : null
}

async function waitForFree(themeProjectId: string): Promise<void> {
	const deadline = Date.now() + QUEUE_MAX_WAIT_MS
	await new Promise(r => setTimeout(r, SYNC_DEBOUNCE_MS))
	while (inFlight.has(themeProjectId) && Date.now() < deadline) await new Promise(r => setTimeout(r, QUEUE_POLL_MS))
}

/** One commit: read the project, render its files, write them. */
async function syncOnce(themeProjectId: string, manual: boolean, force = false): Promise<WrittenFile[]> {
	const project = await prisma.themeProject.findUnique({
		where: { id: themeProjectId },
		include: {
			workSessions: {
				where: { deletedAt: null },
				orderBy: { createdAt: "asc" },
				select: {
					id: true,
					phase: true,
					title: true,
					content: true,
					hoursClaimed: true,
					hoursApproved: true,
					effectiveDate: true,
					createdAt: true,
					timelapses: { select: { playbackUrl: true, objectKey: true, provider: true, externalId: true } },
				},
			},
			user: { select: { id: true, email: true } },
		},
	})
	if (!project) return []

	// Off, or switched off by staff, between the schedule and now. `force` is the first write of an enable, which runs before the switch is set.
	if (!force) {
		if (!project.repoSyncEnabled) return []
		const program = await prisma.programSettings.findUnique({
			where: { id: "singleton" },
			select: { repoSyncEnabled: true },
		})
		if (program?.repoSyncEnabled === false) return []
	}

	// The pinned target is a full URL now, so the forge is inferable from the stored value alone. A row pinned before this change holds a bare `owner/name` with no host, which cannot say which forge it means – that one is resolved against the project's own repo link, the forge the maker was working on when the pin was written.
	const targetRepo = project.repoSyncRepo ?? project.githubRepo
	const pinForge = repoRefFromLink(project.repoSyncRepo)?.forge ?? repoRefFromLink(project.githubRepo)?.forge
	const parsed = targetRepo ? parseRepoRef(targetRepo, pinForge ? { forge: pinForge } : {}) : null
	if (!parsed) {
		await recordFailure(project.id, project.userId, targetRepo ?? "(none)", "No repo is set for this project.", manual)
		return []
	}
	const repo = parsed.fullName
	const forge = parsed.forge

	const creds = await forgeCredentials(project.userId, forge)
	if (!creds) {
		await recordFailure(project.id, project.userId, repo, `${forge.label} is not connected.`, manual)
		return []
	}

	const run = await prisma.repoSyncRun.create({
		data: { themeProjectId: project.id, repo, manual },
		select: { id: true },
	})

	try {
		const isWarmup = project.theme === Theme.WARMUP
		const themeDef = getThemeDef(project.theme)
		const weekId = isWarmup ? WARMUP_WEEK_ID : themeDef.designWeek
		const tier = project.tier ?? project.requestedTier ?? 1

		const meta = {
			id: project.id,
			title: project.title || themeDef.label,
			description: project.description,
			weekId,
			isWarmup,
			themeLabel: themeDef.label,
			tier,
			repoUrl: project.githubRepo,
		}

		const entries: JournalEntry[] = project.workSessions.map(s => ({
			id: s.id,
			phase: s.phase,
			title: s.title,
			content: s.content,
			hoursClaimed: s.hoursClaimed,
			hoursApproved: s.hoursApproved,
			effectiveDate: s.effectiveDate,
			createdAt: s.createdAt,
			timelapses: s.timelapses.map(t => ({ url: t.playbackUrl })),
		}))
		const bom = await listBom(project.id)
		const bomLines: BomLineForFile[] = bom.map(l => ({
			name: l.name,
			purpose: l.purpose,
			quantity: l.quantity,
			unitCostUsd: l.unitCostUsd,
			vendor: l.vendor,
			link: l.link,
			updatedAt: l.updatedAt,
		}))

		const files = [
			renderJournal(meta, entries),
			renderBom(bomLines, project.bomTaxShippingUsd ?? 0),
			// The BOM used to be markdown at BOM.md; the CSV replaces it, and the old file is deleted so a repo never carries both.
			legacyBomDeletion(),
		]

		const branch = await defaultBranchOf(creds, parsed)
		const written = await commitFiles(creds, parsed, branch, files, `Sync ${meta.title} from Half Life`)

		const changed = written.filter(f => !f.unchanged)
		await prisma.$transaction([
			prisma.repoSyncRun.update({
				where: { id: run.id },
				data: {
					files: written.map(f => ({ path: f.path, sha: f.sha, bytes: f.bytes, unchanged: f.unchanged })),
					finishedAt: new Date(),
				},
			}),
			prisma.themeProject.update({
				where: { id: project.id },
				data: { repoSyncedAt: new Date(), repoSyncError: null },
			}),
		])
		// A run that changed nothing is not a sync worth recording: a retry, or a rebuild with identical content, should not look like activity in the audit log.
		if (changed.length > 0) {
			await logAudit({
				action: AuditAction.REPO_SYNC_SUCCESS,
				actorId: null,
				targetType: "ThemeProject",
				targetId: project.id,
				metadata: {
					repo,
					manual,
					files: written.map(f => ({ path: f.path, bytes: f.bytes })),
				},
			})
		}
		return written
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		await recordFailure(project.id, project.userId, repo, message, manual, run.id)
		return []
	}
}

/**
 * Record that a run failed. `repoSyncError` is the only one of these a person sees; the run row and the audit entry are for staff and for the history.
 */
async function recordFailure(
	themeProjectId: string,
	userId: string,
	repo: string,
	message: string,
	manual: boolean,
	runId?: string,
): Promise<void> {
	console.error(`[repo-sync] ${repo} for ${themeProjectId}: ${message}`)
	await prisma
		.$transaction([
			...(runId
				? [
						prisma.repoSyncRun.update({
							where: { id: runId },
							data: { error: message, finishedAt: new Date() },
						}),
					]
				: [
						prisma.repoSyncRun.create({
							data: { themeProjectId, repo, error: message, manual, finishedAt: new Date() },
						}),
					]),
			prisma.themeProject.update({ where: { id: themeProjectId }, data: { repoSyncError: message } }),
		])
		.catch(err => console.error("[repo-sync] failed to record failure:", err))

	await logAudit({
		action: AuditAction.REPO_SYNC_FAILURE,
		actorId: null,
		targetType: "ThemeProject",
		targetId: themeProjectId,
		metadata: { repo, manual, userId, error: message },
	})
}

/**
 * Turn the sync on for a project: pin the repo, verify the forge can write to it, and do the first commit.
 *
 * Refuses rather than half-applying. Switching the sync on against a repo the caller cannot push to would leave every later write failing with a 403 they cannot fix from the platform, so the first commit is done here and its failure means the setting never takes.
 *
 * `repoUrl` is the full URL of the chosen repo, which is what gets pinned. A URL rather than a slug because the forge then stays inferable from the stored value on its own – the sync later reads the pin without having to remember which service the picker was listing.
 */
export async function enableRepoSync(
	themeProjectId: string,
	userId: string,
	repoUrl: string,
): Promise<{ repo: string; files: WrittenFile[] }> {
	const project = await prisma.themeProject.findFirst({
		where: { id: themeProjectId, userId, deletedAt: null },
		select: { id: true, githubRepo: true },
	})
	if (!project) throw new HttpError("NOT_FOUND", "Project not found")

	const ref = repoRefFromLink(repoUrl)
	if (!ref) throw new HttpError("VALIDATION_FAILED", "Pick a repository to sync to")

	const creds = await forgeCredentials(userId, ref.forge)
	if (!creds) throw new HttpError("FORBIDDEN", `Connect your ${ref.forge.label} account first`)

	const repo = ref.fullName
	// Pin the target and clear any stale error before the first commit, so a failure here is recorded against the project the maker is looking at.
	await prisma.themeProject.update({
		where: { id: themeProjectId },
		data: { repoSyncRepo: repoUrl, repoSyncError: null },
	})

	try {
		const files = await runProjectSync(themeProjectId, true, true)
		const failed = await prisma.themeProject.findUnique({
			where: { id: themeProjectId },
			select: { repoSyncError: true },
		})
		if (failed?.repoSyncError) throw new HttpError("UNPROCESSABLE", failed.repoSyncError)

		// Only now is it on, and only after a commit succeeded: `repoSyncEnabled` is what the after-write job reads, so setting it before the first write would leave a project that looks synced and is not.
		await prisma.themeProject.update({ where: { id: themeProjectId }, data: { repoSyncEnabled: true } })
		return { repo, files }
	} catch (err) {
		await prisma.themeProject
			.update({ where: { id: themeProjectId }, data: { repoSyncRepo: null, repoSyncEnabled: false } })
			.catch(() => undefined)
		throw err
	}
}

/** Switch the sync off. The files already in the repo are left where they are. */
export async function disableRepoSync(themeProjectId: string, userId: string): Promise<void> {
	const updated = await prisma.themeProject.updateMany({
		where: { id: themeProjectId, userId, deletedAt: null },
		data: { repoSyncEnabled: false, repoSyncQueuedAt: null, repoSyncError: null },
	})
	if (updated.count === 0) throw new HttpError("NOT_FOUND", "Project not found")
}

/** What the project page and settings need to render the control. */
export type RepoSyncState = {
	enabled: boolean
	/** The repo the sync writes to, or null when it is off. */
	repo: string | null
	/** The forge that repo is on, when one is pinned. */
	forge: string | null
	/** When the last successful run finished, epoch ms. */
	syncedAt: number | null
	/** Why the last attempt failed, or null. */
	error: string | null
	/** Which forges the caller has linked, by id – a maker may link both. */
	linkedForges: string[]
	/**
	 * The project's own repo link, as the alternative the sync target is measured against. Null when the project has none.
	 */
	projectRepo: string | null
	/**
	 * Whether the project's link should be moved to the sync target, so the UI can offer to do it in one press. True when the project has no link, or has one that names a different repo; false when they already agree, or when the target is not a repo Half Life can read (a bare slug, a Codeberg URL).
	 */
	syncRepoDiffers: boolean
}

export async function getRepoSyncState(themeProjectId: string, userId: string): Promise<RepoSyncState> {
	const [project, accounts] = await Promise.all([
		prisma.themeProject.findFirst({
			where: { id: themeProjectId, userId },
			select: { repoSyncEnabled: true, repoSyncRepo: true, githubRepo: true, repoSyncedAt: true, repoSyncError: true },
		}),
		prisma.account.findMany({
			where: { userId, providerId: { in: ALL_FORGES.map(f => f.id) } },
			select: { providerId: true, accessToken: true },
		}),
	])
	if (!project) throw new HttpError("NOT_FOUND", "Project not found")

	// The pinned target is a URL now; an older row still holds a bare slug, which says nothing about its forge on its own. That one is resolved against the project's own repo link – the same fallback the sync uses – so the UI is handed a URL it can link out to rather than a bare `owner/name`.
	const target = project.repoSyncRepo ?? project.githubRepo
	const fallback = repoRefFromLink(project.githubRepo)?.forge
	const ref = repoRefFromLink(target) ?? (target && fallback ? parseRepoRef(target, { forge: fallback }) : null)

	// The link should point at the repo the sync writes to, so the offer to copy it over appears whenever the two disagree – including when the project has no link at all, which is the common case this exists for (the sync was set up first, and the project details never named a repo). A target that will not parse (a bare slug left by an older row, a Codeberg URL) is not offered: the project's repo field takes any repo URL, but writing a value we cannot even read into it would be a guess dressed as a fix.
	const projectRef = repoRefFromLink(project.githubRepo)
	const differs = Boolean(ref && (!projectRef || projectRef.fullName !== ref.fullName))

	return {
		enabled: project.repoSyncEnabled,
		repo: ref ? repoRefToUrl(ref) : target,
		forge: ref?.forge.id ?? null,
		syncedAt: project.repoSyncedAt?.getTime() ?? null,
		error: project.repoSyncError,
		linkedForges: accounts.filter(a => a.accessToken).map(a => a.providerId),
		projectRepo: project.githubRepo,
		syncRepoDiffers: differs,
	}
}
