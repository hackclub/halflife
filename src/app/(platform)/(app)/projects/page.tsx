import type { Metadata } from "next"
import { PageSign } from "@/components/platform/PageSign"
import { ProjectsGrid } from "./ProjectsGrid"
import { WarmupStart } from "./WarmupStart"

export const metadata: Metadata = {
	description: "Every project you have started, and everything you logged against it.",
	title: "Half Life Projects",
}

export default function ProjectsPage() {
	return (
		<div className="mx-auto w-full max-w-[1120px] px-4 pt-2 sm:px-8">
			<PageSign color="var(--color-violet)" label="PROJECTS" />
			<WarmupStart />
			<ProjectsGrid />
		</div>
	)
}
