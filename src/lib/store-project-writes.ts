"use client"

import type { useRouter } from "next/navigation"
import { type Dispatch, type SetStateAction, useCallback, useRef } from "react"
import { z } from "zod"
import { errorMessage } from "./api-error"
import type { StoreSnapshot } from "./queries/store"
import type { ProjectPatch } from "./store"
import { send } from "./store-writes"
import type { Project } from "./types"

/** The project bodies this module reads back from the API. Parsed, so a wrong shape cannot reach the trail. */
const CreatedProjectBody = z.object({ id: z.string() })
const LinkSyncRepoBody = z.object({ githubRepo: z.string().nullish() })

interface ProjectWritesOptions {
	facts: StoreSnapshot
	router: ReturnType<typeof useRouter>
	setFacts: Dispatch<SetStateAction<StoreSnapshot>>
}

export interface ProjectWrites {
	addProject(p: Omit<Project, "id">): void
	ensureProject(weekId: number): Promise<string | null>
	linkSyncRepoToProject(id: string): Promise<string | null>
	setProjectRepo(id: string, url: string | null): Promise<string | null>
	setProjectTier(id: string, tier: 1 | 2 | 3): Promise<string | null>
	updateProject(id: string, patch: ProjectPatch): Promise<string | null>
}

/**
 * Writes about the project row itself: making it, naming it, linking its repo and setting the tier it is aiming for.
 *
 * Each one patches the local snapshot first where it can, because a round trip to Postgres between a click and the change is long enough to feel broken – and the refresh that follows puts the server's answer back if the write failed.
 */
export function useProjectWrites({ facts, router, setFacts }: ProjectWritesOptions): ProjectWrites {
	// In flight per week, so a checkpoint opened twice in a row asks once.
	const ensuring = useRef(new Map<number, Promise<string | null>>())

	const ensureProject = useCallback(
		(weekId: number): Promise<string | null> => {
			const known = facts.projectIdByWeek[weekId]
			if (known) return Promise.resolve(known)
			const pending = ensuring.current.get(weekId)
			if (pending) return pending
			const request = (async () => {
				try {
					const res = await fetch("/api/projects", {
						body: JSON.stringify({ weekId }),
						headers: { "content-type": "application/json" },
						method: "POST",
					})
					if (!res.ok) return null
					const { id } = CreatedProjectBody.parse(await res.json())
					setFacts(f => ({ ...f, projectIdByWeek: { ...f.projectIdByWeek, [weekId]: id } }))
					return id
				} catch {
					return null
				} finally {
					ensuring.current.delete(weekId)
				}
			})()
			ensuring.current.set(weekId, request)
			return request
		},
		[facts.projectIdByWeek, setFacts],
	)

	/**
	 * Naming a week's project – filling in the row its checkpoint made when it was opened (ensureProject). A second project for the same week is refused rather than queued behind the first, where nothing would ever read it.
	 */
	const addProject = useCallback(
		(p: Omit<Project, "id">) => {
			void (async () => {
				try {
					// Normally made when the checkpoint opened; made here if that request had not landed yet, so a quick "Create project" still has a row.
					const id = await ensureProject(p.weekId)
					if (!id) return
					setFacts(f =>
						f.projects.some(existing => existing.weekId === p.weekId)
							? f
							: { ...f, projects: [...f.projects, { ...p, id }] },
					)
					await send(
						`/api/projects/${id}`,
						{
							description: p.description,
							requestedTier: p.tier,
							title: p.name,
							...(p.githubRepo ? { githubRepo: p.githubRepo } : {}),
							...(p.starterProjectId !== undefined ? { starterProjectId: p.starterProjectId } : {}),
						},
						"PATCH",
					)
				} finally {
					router.refresh()
				}
			})()
		},
		[ensureProject, router, setFacts],
	)

	/**
	 * `requestedTier`, never `tier`.
	 *
	 * The assigned tier is a reviewer's decision at design approval, because it is parts money. This is the participant saying which one they are aiming at, and the API refuses to write anything else.
	 */
	const setProjectRepo = useCallback(
		async (id: string, url: string | null): Promise<string | null> => {
			let res: Response
			try {
				res = await fetch(`/api/projects/${id}`, {
					body: JSON.stringify({ githubRepo: url }),
					headers: { "content-type": "application/json" },
					method: "PATCH",
				})
			} catch {
				return "Could not reach the server. Try again."
			}
			if (!res.ok) {
				const err: unknown = await res.json().catch(() => null)
				return errorMessage(err, "That did not save. Try again.")
			}
			setFacts(f => ({
				...f,
				projects: f.projects.map(p => (p.id === id ? { ...p, githubRepo: url } : p)),
			}))
			router.refresh()
			return null
		},
		[router, setFacts],
	)

	const linkSyncRepoToProject = useCallback(
		async (id: string): Promise<string | null> => {
			let res: Response
			try {
				res = await fetch(`/api/projects/${id}/link-sync-repo`, { method: "POST" })
			} catch {
				return "Could not reach the server. Try again."
			}
			const body: unknown = await res.json().catch(() => null)
			if (!res.ok) return errorMessage(body, "That did not save. Try again.")
			const parsed = LinkSyncRepoBody.safeParse(body)
			const url = parsed.success ? (parsed.data.githubRepo ?? null) : null
			setFacts(f => ({
				...f,
				projects: f.projects.map(p => (p.id === id ? { ...p, githubRepo: url } : p)),
			}))
			router.refresh()
			return null
		},
		[router, setFacts],
	)

	const updateProject = useCallback(
		async (id: string, patch: ProjectPatch): Promise<string | null> => {
			let res: Response
			try {
				res = await fetch(`/api/projects/${id}`, {
					body: JSON.stringify({
						...(patch.name !== undefined ? { title: patch.name } : {}),
						...(patch.description !== undefined ? { description: patch.description } : {}),
						...(patch.coverImageKey !== undefined ? { coverImageKey: patch.coverImageKey } : {}),
						...(patch.githubRepo !== undefined ? { githubRepo: patch.githubRepo } : {}),
						...(patch.tier !== undefined ? { requestedTier: patch.tier } : {}),
						...(patch.starterProjectId !== undefined ? { starterProjectId: patch.starterProjectId } : {}),
					}),
					headers: { "content-type": "application/json" },
					method: "PATCH",
				})
			} catch {
				return "Could not reach the server. Try again."
			}
			if (!res.ok) {
				const err: unknown = await res.json().catch(() => null)
				return errorMessage(err, "That did not save. Try again.")
			}
			setFacts(f => ({
				...f,
				projects: f.projects.map(p =>
					p.id === id
						? {
								...p,
								...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
								...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
								...(patch.githubRepo !== undefined ? { githubRepo: patch.githubRepo } : {}),
								...(patch.coverImageKey !== undefined ? { coverImageKey: patch.coverImageKey } : {}),
								...(patch.tier !== undefined ? { tier: patch.tier } : {}),
								...(patch.starterProjectId !== undefined
									? { starter: patch.starterProjectId !== null, starterProjectId: patch.starterProjectId }
									: {}),
							}
						: p,
				),
			}))
			router.refresh()
			return null
		},
		[router, setFacts],
	)

	const setProjectTier = useCallback(
		async (id: string, tier: 1 | 2 | 3): Promise<string | null> => {
			setFacts(f => ({
				...f,
				projects: f.projects.map(p => (p.id === id ? { ...p, tier } : p)),
			}))
			let res: Response
			try {
				res = await fetch(`/api/projects/${id}`, {
					body: JSON.stringify({ requestedTier: tier }),
					headers: { "content-type": "application/json" },
					method: "PATCH",
				})
			} catch {
				router.refresh()
				return "Could not reach the server. Try again."
			}
			router.refresh()
			if (!res.ok) {
				const err: unknown = await res.json().catch(() => null)
				return errorMessage(err, "That tier did not save. Try again.")
			}
			return null
		},
		[router, setFacts],
	)

	return { addProject, ensureProject, linkSyncRepoToProject, setProjectRepo, setProjectTier, updateProject }
}
