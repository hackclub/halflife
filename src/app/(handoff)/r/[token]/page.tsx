import { HandoffUploader } from "@/components/platform/HandoffUploader"
import { PageSign } from "@/components/platform/PageSign"
import { Panel } from "@/components/platform/ui"
import { HANDOFF_TTL_MINUTES, resolveHandoff } from "@/lib/handoff"

// Never cached: the token is single-use and its validity changes the moment a phone claims it.
export const dynamic = "force-dynamic"

/** The phone's measure. The sign is flush to the top edge because this page has no header for its straps to tuck under. */
const pageClass = "mx-auto w-full max-w-xl px-4 pb-12"

export default async function HandoffPage({ params }: { params: Promise<{ token: string }> }) {
	const { token } = await params
	const target = await resolveHandoff(token)

	if (!target)
		return (
			<main className={pageClass}>
				<PageSign color="var(--color-coral)" flush label="LINK EXPIRED" />
				<Panel className="bg-paper px-5 py-5 sm:px-6" radius={20} tone="line">
					<p className="m-0 text-[0.95rem] leading-relaxed text-navy-soft">
						Codes last {HANDOFF_TTL_MINUTES} minutes and work once. Generate a new one on your computer and scan it
						again.
					</p>
				</Panel>
			</main>
		)

	return (
		<main className={pageClass}>
			<PageSign
				color="var(--color-sky)"
				flush
				label="RECORD A REEL"
				sub="Your video goes straight to your Half Life account. You don't need to sign in here."
			/>
			<Panel className="bg-paper px-5 py-5 sm:px-6" radius={20} tone="line">
				<HandoffUploader token={token} />
			</Panel>
		</main>
	)
}
