/* oxlint-disable import/group-exports -- Next.js reads segment config exports statically */

import type { Metadata } from "next"
import { PageSign } from "@/components/platform/PageSign"
import { requireSessionPage } from "@/lib/page-guards"
import { getMyReels } from "@/lib/queries/reels"
import { ReelsList } from "./ReelsList"

export const metadata: Metadata = {
	description: "Your reels, by project, and everywhere you have posted them.",
	title: "Half Life Reels",
}

export const dynamic = "force-dynamic"

export default async function ReelsPage() {
	const { user } = await requireSessionPage()
	const groups = await getMyReels(user.id)

	return (
		<div className="mx-auto w-full max-w-[860px] px-4 pt-2 pb-10 sm:px-8">
			<PageSign color="var(--color-gold)" label="REELS" />
			<ReelsList groups={groups} />
		</div>
	)
}
