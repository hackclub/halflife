import { type ComposerProject, PostComposer } from "@/app/components/forms/PostComposer"
import { LinkButton, PageHeader, Panel } from "@/app/components/ui"
import { themeLabel } from "@/lib/config/program"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasPermission, Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"

export const dynamic = "force-dynamic"

/**
 * Posting to the Doomscroller, on its own page. A post is a deliberate, occasional act, so it gets the room the form needs rather than sharing a screen with the daily moderation queue.
 */
export default async function AdminFeedComposePage() {
	const { user, roles } = await requirePermissionPage(Permission.MANAGE_FEED)

	const projects = await db.orm.public.ThemeProject.select("id", "theme", "title")
		.where({ deletedAt: null, userId: user.id })
		.all()
	const options: ComposerProject[] = projects.map(project => ({
		id: project.id,
		label: project.title || themeLabel(project.theme),
	}))

	return (
		<section className="hl-stack">
			<PageHeader
				actions={<LinkButton href="/admin/feed">Back to the feed</LinkButton>}
				compact
				subtitle="Announcements are pinned above every other reel and are only visible to accounts that can manage the feed. Everything else lands in the Doomscroller in the ordinary order."
				title="Post a reel"
			/>
			{/* The form on the left, and what each choice does on the right, so the page is not one narrow column on a wide screen. */}
			<div className="hl-feed-grid">
				<div>
					<PostComposer canAnnounce={hasPermission(roles, Permission.MANAGE_FEED)} projects={options} />
				</div>
				<Panel title="Before you post">
					<ul
						className="hl-hint"
						style={{ display: "flex", flexDirection: "column", gap: "0.5rem", margin: 0, paddingLeft: "1.1rem" }}
					>
						<li>A video is the reel itself. Use mp4, webm or mov.</li>
						<li>Announcements are pinned above every other reel and are only visible to feed managers.</li>
						<li>A project link is optional. Idea and progress reels usually have one.</li>
						<li>Everything else lands in the Doomscroller in the ordinary order.</li>
					</ul>
				</Panel>
			</div>
		</section>
	)
}
