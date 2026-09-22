import type { Metadata } from "next";
import { ProjectDetail } from "./ProjectDetail";

export const metadata: Metadata = {
  title: "Half Life Project",
  description: "Everything logged against one project, newest first.",
};

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectDetail id={id} />;
}
