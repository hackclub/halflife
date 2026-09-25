import prisma from "@/lib/prisma"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasPermission, Permission } from "@/lib/permissions"
import { getThemeDef } from "@/lib/config/program"
import { PostComposer, type ComposerProject } from "@/app/components/forms/PostComposer"

export const dynamic = "force-dynamic"

/**
 * Where the Half Life team posts to the Doomscroller.
 *
 * The participant-facing trail only ever posts reels against a checkpoint, so
 * without this page there is no way to make an announcement — the pinned kind
 * the feed puts above everything else — or to post anything that is not tied to
 * a week. It is the composer's only home now that the old feed page is gone.
 */
export default async function AdminFeedPage() {
  const { user, roles } = await requirePermissionPage(Permission.MANAGE_FEED)

  const projects = await prisma.themeProject.findMany({
    where: { userId: user.id, deletedAt: null },
    select: { id: true, theme: true, title: true },
  })

  const options: ComposerProject[] = projects.map((project) => ({
    id: project.id,
    label: project.title || getThemeDef(project.theme).label,
  }))

  return (
    <section className="hl-stack">
      <h1>Post to the feed</h1>
      <p className="hl-hint">
        Announcements are pinned above every other reel and are only visible to accounts that can manage the feed.
        Everything else lands in the Doomscroller in the ordinary order.
      </p>
      <PostComposer projects={options} canAnnounce={hasPermission(roles, Permission.MANAGE_FEED)} />
    </section>
  )
}
