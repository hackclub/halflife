import type { Metadata } from "next"
import { requireSessionPage } from "@/lib/page-guards"
import { getProjectPage, getPublicProjectPage } from "@/lib/queries/project-page"
import { ProjectDetail } from "./ProjectDetail"
import { PublicProjectDetail } from "./PublicProjectDetail"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Half Life Project",
  description: "Everything logged against one project, newest first.",
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireSessionPage()
  const { id } = await params
  // Null for someone else's project or a deleted one. Someone else's still
  // opens, read-only and cut to what is public — that is where Explore's
  // "See more" goes. A deleted one gets the client's "no such project".
  const data = await getProjectPage(user.id, id)
  if (!data) {
    const shared = await getPublicProjectPage(id)
    if (shared) return <PublicProjectDetail data={shared} />
  }
  return <ProjectDetail id={id} data={data} />
}
