import type { Metadata } from "next"
import { PageSign } from "@/components/platform/PageSign"
import { requireSessionPage } from "@/lib/page-guards"
import { getMyReels } from "@/lib/queries/reels"
import { ReelsList } from "./ReelsList"

export const metadata: Metadata = {
  title: "Half Life Reels",
  description: "Your reels, by project, and everywhere you have posted them.",
}

export const dynamic = "force-dynamic"

export default async function ReelsPage() {
  const { user } = await requireSessionPage()
  const groups = await getMyReels(user.id)

  return (
    <div className="mx-auto w-full max-w-[860px] px-4 pt-2 pb-10 sm:px-8">
      <PageSign
        label="REELS"
        color="var(--color-gold)"
        sub="Every reel you've posted, by project. Post one on Instagram, TikTok, X or YouTube too and add the link here: if it goes viral, you earn coins."
      />
      <ReelsList groups={groups} />
    </div>
  )
}
