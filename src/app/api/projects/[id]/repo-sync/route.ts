import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { HttpError } from "@/lib/errors"
import { type Forge, forgeById } from "@/lib/forge"
import { forgeCredentials, listWritableRepos, type WritableRepo } from "@/lib/forge-write"
import { type AuthedContext, withSession } from "@/lib/guards"
import db from "@/lib/prisma8"
import { repoRefFromLink } from "@/lib/repo-ref"
import { disableRepoSync, enableRepoSync, getRepoSyncState, runProjectSync } from "@/lib/repo-sync"
import { repoSyncSettingsSchema } from "@/lib/schemas/project"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * The repo sync for one of the caller's projects.
 *
 * GET reads the state and, for each forge the caller has linked, the repos they can push to – the list the settings control offers. It is read here rather than from a separate `/api/me/github` because the only place it is wanted is this control, and one round trip is one less thing to keep in step. A maker who has linked both GitHub and GitLab gets one list from each, each repo carrying the URL that says which forge it belongs to.
 *
 * POST switches the sync on or off. Turning it on writes the first commit before the setting takes (see enableRepoSync), so a repo the token cannot push to is refused here rather than failing silently on every entry afterwards.
 */
export const GET = withSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const state = await getRepoSyncState(id, gate.user.id)

	// Only the linked forges are asked, and only when at least one is: a maker with neither gets the connect prompt, not an empty picker that looks broken.
	const repos: WritableRepo[] = []
	let reposError: string | null = null
	for (const forgeId of state.linkedForges) {
		const forge = forgeById(forgeId)
		if (!forge) continue
		try {
			repos.push(...(await listWritableRepos(gate.user.id, forge)))
		} catch (err) {
			// A failure to list one forge's repos must not take the whole control down with it: the other forge may still answer, and the error names the one that did not.
			reposError = err instanceof Error ? err.message : `${forge.label} did not answer.`
		}
	}

	return ok({ ...state, repos, reposError })
})

export const POST = withSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const parsed = await parseBody(req, repoSyncSettingsSchema)
	if (parsed.error) return parsed.error

	// A project that is gone, or someone else's, is a 404 either way – same as every other project route.
	const owned = await db.orm.public.ThemeProject.where({ deletedAt: null, id, userId: gate.user.id })
		.select("id")
		.first()
	if (!owned) return fail("NOT_FOUND", "Project not found")

	if (!parsed.data.enabled) {
		await disableRepoSync(id, gate.user.id)
		await logAudit({
			action: AuditAction.USER_UPDATE_REPO_SYNC,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: { enabled: false },
			targetId: id,
			targetType: "ThemeProject",
		})
		return ok(await getRepoSyncState(id, gate.user.id))
	}

	if (!parsed.data.repo) return fail("VALIDATION_FAILED", "Pick a repository to sync to")

	const { repo, files } = await enableRepoSync(id, gate.user.id, parsed.data.repo)

	await logAudit({
		action: AuditAction.USER_UPDATE_REPO_SYNC,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: {
			enabled: true,
			files: files.map(f => ({ bytes: f.bytes, path: f.path })),
			repo,
		},
		targetId: id,
		targetType: "ThemeProject",
	})

	return ok({ ...(await getRepoSyncState(id, gate.user.id)), synced: files.length > 0 })
})

/**
 * Force a sync now. Separate from the settings POST because it is a different intent: not "turn this on or off" but "do it again", which is what a maker reaches for after fixing a failure or pushing a change from elsewhere.
 */
export const PUT = withSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const state = await getRepoSyncState(id, gate.user.id)
	if (!state.enabled) throw new HttpError("CONFLICT", "Turn the repo sync on first")

	// Which forge to check against is the pinned repo's own, not a fixed one.
	const ref = repoRefFromLink(state.repo)
	const forge: Forge | null = ref?.forge ?? null
	if (!forge) throw new HttpError("UNPROCESSABLE", "The pinned repo is not one Half Life can write to.")
	if (!(await forgeCredentials(gate.user.id, forge)))
		throw new HttpError("FORBIDDEN", `Connect your ${forge.label} account first`)

	const files = await runProjectSync(id, true)
	const after = await getRepoSyncState(id, gate.user.id)
	// A manual run that recorded an error is a refusal, not a quiet success: the button's whole point is to find out whether it worked now.
	if (after.error) throw new HttpError("UNPROCESSABLE", after.error)

	return ok({ ...after, synced: files.length > 0 })
})
