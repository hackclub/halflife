import { type ComposerProject, PostComposer } from "@/app/components/forms/PostComposer"
import { LinkButton, PageHeader } from "@/app/components/ui"
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
			<div className="hl-measure">
				<PostComposer canAnnounce={hasPermission(roles, Permission.MANAGE_FEED)} projects={options} />
			</div>
		</section>
	)
}
