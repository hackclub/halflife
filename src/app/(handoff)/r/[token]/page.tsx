import { HandoffUploader } from "@/app/components/forms/HandoffUploader"
import { Callout, PageHeader, Panel } from "@/app/components/ui"
import { HANDOFF_TTL_MINUTES, resolveHandoff } from "@/lib/handoff"

// Never cached: the token is single-use and its validity changes the moment a phone claims it.
export const dynamic = "force-dynamic"

export default async function HandoffPage({ params }: { params: Promise<{ token: string }> }) {
	const { token } = await params
	const target = await resolveHandoff(token)

	if (!target)
		return (
			<div className="hl-stack">
				<PageHeader title="This link has expired" />
				<Callout tone="warning">
					Codes last {HANDOFF_TTL_MINUTES} minutes and work once. Generate a new one on your computer and scan it again.
				</Callout>
			</div>
		)

	return (
		<div className="hl-stack">
			<PageHeader
				subtitle="Your video goes straight to your Half Life account. You don't need to sign in here."
				title="Record your reel"
			/>
			<Panel>
				<HandoffUploader token={token} />
			</Panel>
		</div>
	)
}
