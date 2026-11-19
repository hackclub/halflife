import type { Metadata } from "next"
import Link from "next/link"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { Badge, EmptyState, LinkButton, PageHeader, Panel, Table } from "@/app/components/ui"
import { formatUtcDateTime } from "@/lib/deadline"
import { displayName } from "@/lib/display-name"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import {
	listRecentCommentsForModeration,
	listRecentPostsForModeration,
	listRecentPublicReels,
} from "@/lib/queries/admin"
import { preview } from "@/lib/text"
import { isTruthy } from "@/lib/truthy"

export const metadata: Metadata = {
	title: "Feed",
}

export const dynamic = "force-dynamic"

/**
 * Where the Half Life team posts to the Doomscroller, and where a reel or comment that should not be visible is taken down.
 *
 * The composer is the only way to make an announcement – the participant trail only posts reels against a checkpoint. The moderation lists are the only way to hide one: the API routes behind them have always existed (the comment one was added alongside this page), and a moderation capability nobody can reach is not a capability.
 */
export default async function AdminFeedPage() {
	await requirePermissionPage(Permission.MANAGE_FEED)

	const [posts, comments, publicReels] = await Promise.all([
		listRecentPostsForModeration(),
		listRecentCommentsForModeration(),
		listRecentPublicReels(),
	])

	return (
		<section className="hl-stack">
			<PageHeader
				actions={
					<LinkButton href="/admin/feed/compose" variant="primary">
						Post a reel
					</LinkButton>
				}
				compact
				subtitle="Everything posted to the Doomscroller, and where a reel or comment needs to be taken down. Announcements are pinned above every other reel."
				title="Feed"
			/>
			<div className="hl-stack">
				<Panel title="Recent reels">
					{posts.length === 0 ? (
						<EmptyState>No reels yet.</EmptyState>
					) : (
						<Table head={["Author", "Reel", "Posted", ""]}>
							{posts.map(post => (
								<tr key={post.id}>
									<td>
										<Link href={`/admin/users/${post.user.id}`}>{displayName(post.user, post.user.email)}</Link>
									</td>
									<td>
										{post.hiddenAt ? (
											<Badge tone="danger">hidden</Badge>
										) : post.kind === "ANNOUNCEMENT" ? (
											<Badge tone="warning">announcement</Badge>
										) : null}
										<span className="hl-hint">
											{" "}
											{preview(post.caption) || post.themeProject?.title || "no caption"}
										</span>
										{post.hiddenReason ? <div className="hl-hint">hidden: {preview(post.hiddenReason, 60)}</div> : null}
									</td>
									<td className="hl-mono">{formatUtcDateTime(post.publishedAt ?? post.createdAt)}</td>
									<td>
										{post.hiddenAt ? (
											<ActionButton
												confirm="Put this reel back in the feed?"
												label="Restore"
												method="DELETE"
												url={`/api/admin/posts/${post.id}/moderate`}
											/>
										) : (
											<ActionButton
												confirm="Hide this reel from every feed?"
												label="Hide"
												reasonPrompt="Why is this reel being hidden?"
												tone="danger"
												url={`/api/admin/posts/${post.id}/moderate`}
												variant="default"
											/>
										)}
									</td>
								</tr>
							))}
						</Table>
					)}
					<p className="hl-hint">
						A hidden reel stays as a record; restoring puts it back. A hidden comment cannot be restored yet.
					</p>
				</Panel>

				<Panel title="Recent comments">
					{comments.length === 0 ? (
						<EmptyState>No comments yet.</EmptyState>
					) : (
						<Table head={["Author", "Comment", "Posted", ""]}>
							{comments.map(comment => (
								<tr key={comment.id}>
									<td>{displayName(comment.user, comment.user.email)}</td>
									<td>
										{comment.hiddenAt ? <Badge tone="danger">hidden</Badge> : null}
										<span className="hl-hint"> {preview(comment.body)}</span>
										{isTruthy(comment.post) ? (
											<div className="hl-hint">on {preview(comment.post.caption, 60) || "a reel"}</div>
										) : null}
									</td>
									<td className="hl-mono">{formatUtcDateTime(comment.createdAt)}</td>
									<td>
										{comment.hiddenAt ? (
											<span className="hl-hint">hidden</span>
										) : (
											<ActionButton
												confirm="Hide this comment from every feed?"
												label="Hide"
												reasonPrompt="Why is this comment being hidden?"
												tone="danger"
												url={`/api/admin/comments/${comment.id}/moderate`}
												variant="default"
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
							{publicReels.map(reel => (
								<tr key={reel.id}>
									<td>{reel.platform.toLowerCase()}</td>
									<td>
										<Link href={`/admin/users/${reel.user.id}`}>{displayName(reel.user) ?? reel.email}</Link>
									</td>
									<td>
										<a className="hl-hint" href={reel.url} rel="noreferrer" target="_blank">
											{reel.url}
										</a>
									</td>
									<td className="hl-hint">{reel.themeProject?.title ?? reel.post?.caption?.slice(0, 60) ?? "-"}</td>
									<td className="hl-mono">{formatUtcDateTime(reel.postedAt)}</td>
								</tr>
							))}
						</Table>
					)}
					<p className="hl-hint">Where a reel went viral: the links participants claimed for the virality prizes.</p>
				</Panel>
			</div>
		</section>
	)
}
