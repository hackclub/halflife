import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { HttpError } from "@/lib/errors"
import { githubCredentials, listWritableRepos } from "@/lib/github-write"
import { requireSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import {
  disableRepoSync,
  enableRepoSync,
  getRepoSyncState,
  runProjectSync,
} from "@/lib/repo-sync"
import { repoSyncSettingsSchema } from "@/lib/schemas/project"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * The GitHub sync for one of the caller's projects.
 *
 * GET reads the state and, when GitHub is linked, the repos the caller can push
 * to — the list the settings control offers. It is read here rather than from a
 * separate `/api/me/github` because the only place it is wanted is this control,
 * and one round trip is one less thing to keep in step.
 *
 * POST switches the sync on or off. Turning it on writes the first commit before
 * the setting takes (see enableRepoSync), so a repo the token cannot push to is
 * refused here rather than failing silently on every entry afterwards.
 */
export const GET = withRoute(async (_req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id } = await params

  const state = await getRepoSyncState(id, gate.user.id)

  // Only when linked: a maker without GitHub gets the connect prompt, not an
  // empty picker that looks broken.
  let repos: Awaited<ReturnType<typeof listWritableRepos>> = []
  let reposError: string | null = null
  if (state.githubLinked) {
    try {
      repos = await listWritableRepos(gate.user.id)
    } catch (err) {
      // A failure to list repos must not take the state down with it: the
      // control still says whether the sync is on, and can offer a retry.
      reposError = err instanceof Error ? err.message : "GitHub did not answer."
    }
  }

  return ok({ ...state, repos, reposError })
})

export const POST = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, repoSyncSettingsSchema)
  if (parsed.error) return parsed.error

  // A project that is gone, or someone else's, is a 404 either way — same as
  // every other project route.
  const owned = await prisma.themeProject.findFirst({
    where: { id, userId: gate.user.id, deletedAt: null },
    select: { id: true },
  })
  if (!owned) return fail("NOT_FOUND", "Project not found")

  if (!parsed.data.enabled) {
    await disableRepoSync(id, gate.user.id)
    await logAudit({
      action: AuditAction.USER_UPDATE_REPO_SYNC,
      actorId: gate.user.id,
      actorEmail: gate.user.email,
      targetType: "ThemeProject",
      targetId: id,
      metadata: { enabled: false },
    })
    return ok(await getRepoSyncState(id, gate.user.id))
  }

  if (!parsed.data.repo) return fail("VALIDATION_FAILED", "Pick a GitHub repo")

  const { repo, files } = await enableRepoSync(id, gate.user.id, parsed.data.repo)

  await logAudit({
    action: AuditAction.USER_UPDATE_REPO_SYNC,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "ThemeProject",
    targetId: id,
    metadata: {
      enabled: true,
      repo,
      files: files.map((f) => ({ path: f.path, bytes: f.bytes })),
    },
  })

  return ok({ ...(await getRepoSyncState(id, gate.user.id)), synced: files.length > 0 })
})

/**
 * Force a sync now. Separate from the settings POST because it is a different
 * intent: not "turn this on or off" but "do it again", which is what a maker
 * reaches for after fixing a failure or pushing a change from elsewhere.
 */
export const PUT = withRoute(async (_req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id } = await params

  const state = await getRepoSyncState(id, gate.user.id)
  if (!state.enabled) throw new HttpError("CONFLICT", "Turn the repo sync on first")
  if (!(await githubCredentials(gate.user.id))) {
    throw new HttpError("FORBIDDEN", "Connect your GitHub account first")
  }

  const files = await runProjectSync(id, true)
  const after = await getRepoSyncState(id, gate.user.id)
  // A manual run that recorded an error is a refusal, not a quiet success: the
  // button's whole point is to find out whether it worked now.
  if (after.error) throw new HttpError("UNPROCESSABLE", after.error)

  return ok({ ...after, synced: files.length > 0 })
})
