import type { Metadata } from "next"
import { PageSign } from "@/components/platform/PageSign"
import { StarterPicker } from "@/components/platform/starters/StarterPicker"
import { DISPLAY_STARTERS, getDisplayStarter } from "@/lib/config/display-starters"

export const metadata: Metadata = {
	description: "Week 4's starter projects: seven displays, each with a full guide.",
	title: "Half Life Display Guides",
}

/**
 * Starter projects, Stasis-style: one picker for the week's starters and a guide behind each. Week 4 (Displays) is the only week with its own set so far, so this is that week's page; the `?display=` param picks which one is open, which is how a guide's back link returns you to it.
 */
export default async function StarterProjects({ searchParams }: { searchParams: Promise<{ display?: string }> }) {
	const { display } = await searchParams
	const initial = (display && getDisplayStarter(display)?.slug) ?? DISPLAY_STARTERS[0].slug

	return (
		<div className="mx-auto w-full max-w-[1040px] px-4 pt-2 sm:px-8">
			<PageSign
				color="var(--color-orange)"
				label="STARTER PROJECTS"
				sub="week 4 is displays! pick one, follow its guide, then come up with a project that uses it!"
			/>

			<StarterPicker initial={initial} />

			<p className="hand mx-auto max-w-[52ch] py-10 text-center text-[0.86rem] leading-relaxed text-navy-soft">
				a guide is a starting point, you can't copy a starter project exactly. change the design, the case and the code until it&apos;s uniquely your project!
			</p>
		</div>
	)
}
