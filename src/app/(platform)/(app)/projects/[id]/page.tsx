import type { Metadata } from "next"
import { requireSessionPage } from "@/lib/page-guards"
import { hasPermission, Permission } from "@/lib/permissions"
import { getOpenDisputesForProject, getProjectPage, getPublicProjectPage } from "@/lib/queries/project-page"
import { ProjectDetail } from "./ProjectDetail"
import { PublicProjectDetail } from "./PublicProjectDetail"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
	description: "Everything logged against one project, newest first.",
	title: "Half Life Project",
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
	const { user, roles } = await requireSessionPage()
	const { id } = await params
	// Null for someone else's project or a deleted one. Someone else's still opens, read-only and cut to what is public – that is where Explore's "See more" goes. A deleted one gets the client's "no such project".
	const data = await getProjectPage(user.id, id)
	if (!data) {
		const shared = await getPublicProjectPage(id)
		if (shared) {
			// Reviewers open this page from a dispute notice, so the one thing it cannot show them – the console page where the thread is answered – is a click away.
			const openDisputes = hasPermission(roles, Permission.REVIEW_SUBMISSIONS)
				? await getOpenDisputesForProject(id)
				: []
			return <PublicProjectDetail data={shared} openDisputes={openDisputes} />
		}
	}
	return <ProjectDetail data={data} id={id} />
}
