import { SafeLink } from "@/components/review/ui"
import { checkUnified } from "@/lib/airtable/unified-duplicates"

/**
 * Whether the unified database already has a project at this code or playable URL – Fabricate's `UnifiedCheck`, rendered on the server and streamed into the T2 screen.
 *
 * A match under another program, or any match for a design, is the warning: a design should not be in the unified database before its first T2, while a build matching its own Half Life design is expected.
 */
export async function UnifiedCheck({
	codeUrl,
	email,
	kind,
	playableUrl,
}: {
	codeUrl: string
	email: string
	kind: "design" | "build"
	playableUrl: string
}) {
	const check = await checkUnified({ codeUrl, email, playableUrl })
	if (!check.configured)
		return (
			<p className="field__hint">
				Unified check is off. Set AIRTABLE_UNIFIED_BASE_ID and AIRTABLE_UNIFIED_APPROVED_TABLE to turn it on.
			</p>
		)
	if ("error" in check)
		return (
			<p className="field__error" role="alert">
				Couldn&rsquo;t check Unified: {check.error}
			</p>
		)
	if (check.matches.length === 0)
		return (
			<p className="unified__check tone-ok">Not in Unified yet: no approved project uses this code or playable URL.</p>
		)
	return (
		<div className="unified__check">
			<p className={check.matches.some(match => !match.sameProgram || kind === "design") ? "tone-warn" : undefined}>
				<strong>Already in Unified</strong> ({check.matches.length}):
			</p>
			<ul>
				{check.matches.map(match => (
					<li key={`${match.ysws}:${match.codeUrl}:${match.playableUrl}:${match.approvedAt}`}>
						<strong>{match.ysws}</strong>
						{match.approvedAt ? `, approved ${match.approvedAt}` : ""},{" "}
						{match.sameMaker ? "same maker" : "different maker"} · <SafeLink href={match.codeUrl} />
						{match.playableUrl && match.playableUrl !== match.codeUrl ? (
							<>
								{" · "}
								<SafeLink href={match.playableUrl} />
							</>
						) : null}
					</li>
				))}
			</ul>
		</div>
	)
}
