import "server-only"
import { Phase, type PhaseStatus, PostStatus, type PublicReelPlatform } from "@/app/generated/prisma/enums"
import { DESIGN_WEEKS, THEMES } from "@/lib/config/program"
import { progressReelHours } from "@/lib/curriculum"
import prisma from "@/lib/prisma"
import { reelLockReason } from "@/lib/reel-gate"
import { publicUrlFor } from "@/lib/uploads/r2"
import { warmupPhaseOf } from "@/lib/warmup"

/**
 * Everything the Reels page shows: the participant's own reels, grouped by the project each belongs to, with every public link they have added to each.
 *
 * Their own reels only, and including ones a moderator took out of the feed – the author still sees those, as the feed's own rule has it. A removed reel is gone for them too.
 */

export interface MyPublicLink {
	id: string
	platform: PublicReelPlatform
	postedAt: number
	url: string
}

export interface MyReel {
	at: number
	caption: string
	/** Why this reel cannot be deleted – its week is in review, decided or over. Null when it can. */
	deleteLocked: string | null
	id: string
	links: MyPublicLink[]
	/**
	 * Whether deleting it reopens its checkpoint: the last reel on an idea or progress checkpoint. The map then holds everything else until it is back.
	 */
	reopensCheckpoint: boolean
	status: PostStatus
	thumbnailUrl: string | null
	/** What the reel was for, in the trail's words: "Idea reel", "2.5h progress reel". */
	title: string
	videoUrl: string | null
}

export interface MyReelGroup {
	/** Null for reels posted outside any project. */
	project: { id: string; title: string; theme: string } | null
	reels: MyReel[]
}

/**
 * The checkpoint a reel answered, named the way the trail names it. A progress reel's hours depend on its week's phase: a season week says it by number (past DESIGN_WEEKS is a build), a warm-up by the phase it is handed in as.
 */
function titleFor(
	checkpointKey: string | null,
	kind: string,
	project: { warmupPhase: Phase | null; buildStatus: PhaseStatus } | null,
): string {
	const slot = checkpointKey ? /-reel-(.+)$/.exec(checkpointKey)?.[1] : null
	if (slot === "idea") return "Idea reel"
	if (slot === "submission") return "Closing reel"
	if (checkpointKey && slot && /^\d+$/.test(slot)) {
		const week = /^w(\d{1,2})-/.exec(checkpointKey)?.[1]
		const build = week ? Number(week) > DESIGN_WEEKS : project !== null && warmupPhaseOf(project) === Phase.BUILD
		return `${progressReelHours(build ? "build" : "design", Number(slot))}h progress reel`
	}
	if (kind === "IDEA") return "Idea reel"
	if (kind === "SUBMISSION") return "Closing reel"
	if (kind === "PROGRESS") return "Progress reel"
	return "Reel"
}

export async function getMyReels(userId: string): Promise<MyReelGroup[]> {
	const posts = await prisma.post.findMany({
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		select: {
			caption: true,
			checkpointKey: true,
			createdAt: true,
			id: true,
			kind: true,
			objectKey: true,
			publicReels: {
				orderBy: { postedAt: "asc" },
				select: { id: true, platform: true, postedAt: true, url: true },
			},
			publishedAt: true,
			status: true,
			themeProject: {
				select: { buildStatus: true, deletedAt: true, id: true, theme: true, title: true, warmupPhase: true },
			},
			thumbnailKey: true,
		},
		where: { deletedAt: null, status: { not: PostStatus.REMOVED }, userId },
	})

	// How many live reels each checkpoint has, so a second one can go without reopening anything. And each checkpoint week's lock, asked once per week.
	const perKey = new Map<string, number>()
	for (const p of posts) if (p.checkpointKey) perKey.set(p.checkpointKey, (perKey.get(p.checkpointKey) ?? 0) + 1)
	const locks = new Map<string, Promise<string | null>>()
	const lockFor = (projectId: string | null, key: string) => {
		const k = `${projectId}:${key.replace(/-reel-.*$/, "")}`
		if (!locks.has(k)) locks.set(k, reelLockReason(userId, projectId, key))
		return locks.get(k) as Promise<string | null>
	}

	const groups = new Map<string, MyReelGroup>()
	for (const p of posts) {
		const project = p.themeProject && !p.themeProject.deletedAt ? p.themeProject : null
		const key = project?.id ?? "none"
		if (!groups.has(key)) {
			const theme = project ? THEMES.find(t => t.id === project.theme) : undefined
			groups.set(key, {
				project: project
					? {
							id: project.id,
							theme: theme?.label ?? project.theme,
							title: project.title || theme?.label || "Untitled project",
						}
					: null,
				reels: [],
			})
		}
		groups.get(key)?.reels.push({
			at: (p.publishedAt ?? p.createdAt).getTime(),
			caption: p.caption,
			deleteLocked: p.checkpointKey ? await lockFor(p.themeProject?.id ?? null, p.checkpointKey) : null,
			id: p.id,
			links: p.publicReels.map(l => ({
				id: l.id,
				platform: l.platform,
				postedAt: l.postedAt.getTime(),
				url: l.url,
			})),
			reopensCheckpoint:
				p.checkpointKey !== null && /-reel-(idea|\d{1,2})$/.test(p.checkpointKey) && perKey.get(p.checkpointKey) === 1,
			status: p.status,
			thumbnailUrl: publicUrlFor(p.thumbnailKey),
			title: titleFor(p.checkpointKey, p.kind, p.themeProject),
			videoUrl: publicUrlFor(p.objectKey),
		})
	}

	// Projects in trail order, so PCB reads before CAD whatever was posted last; reels outside any project come after them.
	const order = (g: MyReelGroup) => {
		if (!g.project) return Number.MAX_SAFE_INTEGER
		const i = THEMES.findIndex(t => t.label === g.project?.theme)
		return i === -1 ? THEMES.length : i
	}
	return [...groups.values()].toSorted((a, b) => order(a) - order(b))
}
