import Link from "next/link"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { type ComposerProject, PostComposer } from "@/app/components/forms/PostComposer"
import { Badge, EmptyState, Panel, Table } from "@/app/components/ui"
import { getThemeDef } from "@/lib/config/program"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasPermission, Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { listRecentCommentsForModeration, listRecentPostsForModeration, listRecentPublicReels } from "@/lib/queries/admin"

export const dynamic = "force-dynamic"

const whenFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  dateStyle: "medium",
  timeStyle: "short",
})

function preview(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * Where the Half Life team posts to the Doomscroller, and where a reel or
 * comment that should not be visible is taken down.
 *
 * The composer is the only way to make an announcement — the participant
 * trail only posts reels against a checkpoint. The moderation lists are the
 * only way to hide one: the API routes behind them have always existed (the
 * comment one was added alongside this page), and a moderation capability
 * nobody can reach is not a capability.
 */
export default async function AdminFeedPage() {
  const { user, roles } = await requirePermissionPage(Permission.MANAGE_FEED)

  const [projects, posts, comments, publicReels] = await Promise.all([
    prisma.themeProject.findMany({
      where: { userId: user.id, deletedAt: null },
      select: { id: true, theme: true, title: true },
    }),
    listRecentPostsForModeration(),
    listRecentCommentsForModeration(),
    listRecentPublicReels(),
  ])

  const options: ComposerProject[] = projects.map((project) => ({
    id: project.id,
    label: project.title || getThemeDef(project.theme).label,
  }))

  return (
    <section className="hl-stack">
      <h1>Post to the feed</h1>
      <p className="hl-hint">
        Announcements are pinned above every other reel and are only visible to accounts that can manage the feed. Everything else
        lands in the Doomscroller in the ordinary order.
      </p>
      <PostComposer projects={options} canAnnounce={hasPermission(roles, Permission.MANAGE_FEED)} />

      <Panel title="Recent reels">
        {posts.length === 0 ? (
          <EmptyState>No reels yet.</EmptyState>
        ) : (
          <Table head={["Author", "Reel", "Posted", ""]}>
            {posts.map((post) => (
              <tr key={post.id}>
                <td>
                  <Link href={`/admin/users/${post.user.id}`}>{post.user.name ?? post.user.email}</Link>
                </td>
                <td>
                  {post.hiddenAt ? (
                    <Badge tone="danger">hidden</Badge>
                  ) : post.kind === "ANNOUNCEMENT" ? (
                    <Badge tone="warning">announcement</Badge>
                  ) : null}
                  <span className="hl-hint"> {preview(post.caption) || post.themeProject?.title || "no caption"}</span>
                  {post.hiddenReason ? <div className="hl-hint">hidden: {preview(post.hiddenReason, 60)}</div> : null}
                </td>
                <td className="hl-mono">{whenFormat.format(post.publishedAt ?? post.createdAt)}</td>
                <td>
                  {post.hiddenAt ? (
                    <ActionButton
                      url={`/api/admin/posts/${post.id}/moderate`}
                      method="DELETE"
                      label="Restore"
                      confirm="Put this reel back in the feed?"
                    />
                  ) : (
                    <ActionButton
                      url={`/api/admin/posts/${post.id}/moderate`}
                      label="Hide"
                      variant="danger"
                      confirm="Hide this reel from every feed?"
                      reasonPrompt="Why is this reel being hidden?"
                    />
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <p className="hl-hint">A hidden reel stays as a record; restoring puts it back. A hidden comment cannot be restored yet.</p>
      </Panel>

      <Panel title="Recent comments">
        {comments.length === 0 ? (
          <EmptyState>No comments yet.</EmptyState>
        ) : (
          <Table head={["Author", "Comment", "Posted", ""]}>
            {comments.map((comment) => (
              <tr key={comment.id}>
                <td>{comment.user.name ?? comment.user.email}</td>
                <td>
                  {comment.hiddenAt ? <Badge tone="danger">hidden</Badge> : null}
                  <span className="hl-hint"> {preview(comment.body)}</span>
                  {comment.post ? <div className="hl-hint">on {preview(comment.post.caption, 60) || "a reel"}</div> : null}
                </td>
                <td className="hl-mono">{whenFormat.format(comment.createdAt)}</td>
                <td>
                  {comment.hiddenAt ? (
                    <span className="hl-hint">hidden</span>
                  ) : (
                    <ActionButton
                      url={`/api/admin/comments/${comment.id}/moderate`}
                      label="Hide"
                      variant="danger"
                      confirm="Hide this comment from every feed?"
                      reasonPrompt="Why is this comment being hidden?"
                    />
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Public reel links">
        {publicReels.length === 0 ? (
          <EmptyState>No public links claimed yet.</EmptyState>
        ) : (
          <Table head={["Platform", "Maker", "Link", "Reel", "Added"]}>
            {publicReels.map((reel) => (
              <tr key={reel.id}>
                <td>{reel.platform.toLowerCase()}</td>
                <td>
                  <Link href={`/admin/users/${reel.user.id}`}>{reel.user.name ?? reel.email}</Link>
                </td>
                <td>
                  <a href={reel.url} target="_blank" rel="noreferrer" className="hl-hint">
                    {reel.url}
                  </a>
                </td>
                <td className="hl-hint">{reel.themeProject?.title ?? reel.post?.caption?.slice(0, 60) ?? "—"}</td>
                <td className="hl-mono">{whenFormat.format(reel.postedAt)}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="hl-hint">Where a reel went viral — the links participants claimed for the virality prizes.</p>
      </Panel>
    </section>
  )
}
