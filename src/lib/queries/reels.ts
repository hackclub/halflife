import "server-only"
import prisma from "@/lib/prisma"
import { PostStatus, type PublicReelPlatform } from "@/app/generated/prisma/enums"
import { THEMES } from "@/lib/config/program"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * Everything the Reels page shows: the participant's own reels, grouped by
 * the project each belongs to, with every public link they have added to each.
 *
 * Their own reels only, and including ones a moderator took out of the feed —
 * the author still sees those, as the feed's own rule has it. A removed reel
 * is gone for them too.
 */

export interface MyPublicLink {
  id: string
  platform: PublicReelPlatform
  url: string
  postedAt: number
}

export interface MyReel {
  id: string
  /** What the reel was for, in the trail's words: "Idea reel", "10h progress reel". */
  title: string
  caption: string
  at: number
  videoUrl: string | null
  thumbnailUrl: string | null
  status: PostStatus
  links: MyPublicLink[]
}

export interface MyReelGroup {
  /** Null for reels posted outside any project. */
  project: { id: string; title: string; theme: string } | null
  reels: MyReel[]
}

/** The checkpoint a reel answered, named the way the trail names it. */
function titleFor(checkpointKey: string | null, kind: string): string {
  const slot = checkpointKey ? /-reel-(.+)$/.exec(checkpointKey)?.[1] : null
  if (slot === "idea") return "Idea reel"
  if (slot === "submission") return "Closing reel"
  if (slot && /^\d+$/.test(slot)) return `${Number(slot) * 10}h progress reel`
  if (kind === "IDEA") return "Idea reel"
  if (kind === "SUBMISSION") return "Closing reel"
  if (kind === "PROGRESS") return "Progress reel"
  return "Reel"
}

export async function getMyReels(userId: string): Promise<MyReelGroup[]> {
  const posts = await prisma.post.findMany({
    where: { userId, deletedAt: null, status: { not: PostStatus.REMOVED } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      kind: true,
      caption: true,
      checkpointKey: true,
      objectKey: true,
      thumbnailKey: true,
      status: true,
      createdAt: true,
      publishedAt: true,
      themeProject: { select: { id: true, title: true, theme: true, deletedAt: true } },
      publicReels: {
        orderBy: { postedAt: "asc" },
        select: { id: true, platform: true, url: true, postedAt: true },
      },
    },
  })

  const groups = new Map<string, MyReelGroup>()
  for (const p of posts) {
    const project = p.themeProject && !p.themeProject.deletedAt ? p.themeProject : null
    const key = project?.id ?? "none"
    if (!groups.has(key)) {
      const theme = project ? THEMES.find((t) => t.id === project.theme) : undefined
      groups.set(key, {
        project: project
          ? {
              id: project.id,
              title: project.title || theme?.label || "Untitled project",
              theme: theme?.label ?? project.theme,
            }
          : null,
        reels: [],
      })
    }
    groups.get(key)?.reels.push({
      id: p.id,
      title: titleFor(p.checkpointKey, p.kind),
      caption: p.caption,
      at: (p.publishedAt ?? p.createdAt).getTime(),
      videoUrl: publicUrlFor(p.objectKey),
      thumbnailUrl: publicUrlFor(p.thumbnailKey),
      status: p.status,
      links: p.publicReels.map((l) => ({
        id: l.id,
        platform: l.platform,
        url: l.url,
        postedAt: l.postedAt.getTime(),
      })),
    })
  }

  // Projects in trail order, so PCB reads before CAD whatever was posted last;
  // reels outside any project come after them.
  const order = (g: MyReelGroup) => {
    if (!g.project) return Number.MAX_SAFE_INTEGER
    const i = THEMES.findIndex((t) => t.label === g.project?.theme)
    return i === -1 ? THEMES.length : i
  }
  return [...groups.values()].sort((a, b) => order(a) - order(b))
}
