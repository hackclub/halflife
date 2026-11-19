import { ManageSection } from "@/app/components/admin/ProjectManage"
import { ExtensionForm } from "@/app/components/forms/ExtensionForm"
import { StarterForm } from "@/app/components/forms/StarterForm"
import { ThemeMoveForm } from "@/app/components/forms/ThemeMoveForm"
import { starterProjectsFor } from "@/lib/config/onboarding"
import type { Theme } from "@/lib/enums"

/**
 * The controls every project's admin panel shares: moving it to another theme, its starter project and its extension. The projects list and a user's themed projects both render these, so an admin finds the same controls in the same order wherever a project appears.
 */
export function ProjectControls({
	canExtend,
	canMoveTheme,
	extension,
	projectId,
	starterProjectId,
	theme,
	userExtension,
}: Readonly<{
	canExtend: boolean
	canMoveTheme: boolean
	/** ISO string of the project's own extension, if any. */
	extension: string | null
	projectId: string
	starterProjectId: string | null
	theme: Theme
	/** The owner-wide extension, already formatted, when one is running. */
	userExtension?: string | null
}>) {
	return (
		<>
			{canMoveTheme ? (
				<ManageSection title="Move to theme">
					<ThemeMoveForm current={theme} projectId={projectId} />
				</ManageSection>
			) : null}
			{canMoveTheme && starterProjectsFor(theme).length > 0 ? (
				<ManageSection title="Starter project">
					<StarterForm current={starterProjectId} projectId={projectId} theme={theme} />
				</ManageSection>
			) : null}
			{canExtend ? (
				<ManageSection title="Extension">
					<ExtensionForm current={extension} url={`/api/admin/theme-projects/${projectId}`} />
					{userExtension ? <p className="hl-hint">Owner extended until {userExtension}</p> : null}
				</ManageSection>
			) : null}
		</>
	)
}
