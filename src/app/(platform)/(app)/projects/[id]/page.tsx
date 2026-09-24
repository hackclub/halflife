import type { Metadata } from "next";
import { requireSessionPage } from "@/lib/page-guards";
import { getProjectPage } from "@/lib/queries/project-page";
import { ProjectDetail } from "./ProjectDetail";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Half Life Project",
  description: "Everything logged against one project, newest first.",
};

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireSessionPage();
  const { id } = await params;
  // Null for someone else's project or a deleted one; the client says so,
  // the same way it does when the store has no such project.
  const data = await getProjectPage(user.id, id);
  return <ProjectDetail id={id} data={data} />;
}
