import type { NextRequest } from "next/server"
import { ok } from "@/lib/api"
import { lockUserCredit, reconcileGrant } from "@/lib/currency"
import { LedgerKind, Phase } from "@/lib/enums"
import { grantCardCapUsd } from "@/lib/grant-card-policy"
import { isWeekOneStarter } from "@/lib/grant-cards"
import { grantReturnCoins } from "@/lib/grant-return-coins"
import { wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"
import db from "@/lib/prisma8"

/**
 * The 12 grants cancelled before activation and reissued, with the project each was for. The grant pages name these projects,
 * and each project has a live CSV row from the reissue. The three that were not paid are left out on purpose.
 */
const GRANTS: { grantId: string; projectId: string }[] = [
	{ grantId: "16I2Z1", projectId: "cmuxa7ax400qa01m36bdp28j3" },
	{ grantId: "j8I7yJ", projectId: "cmuvskwsv00o901oskej2t8j2" },
	{ grantId: "QgIln3", projectId: "cmuxtmz2o00vy01ngo5n8l9et" },
	{ grantId: "ZEIyP5", projectId: "cmuvgtdei001201opo4l1fohf" },
	{ grantId: "57Ir57", projectId: "cmuvjbd2900fb01py3qtzb5c5" },
	{ grantId: "8pImz9", projectId: "cmuv9q1qn0fcp01smvtev21ch" },
	{ grantId: "0EIBk9", projectId: "cmuvz35l503gs01oszhmbbttw" },
	{ grantId: "k5Ib03", projectId: "cmv2o9tb106lm01q3dbpmx4u5" },
	{ grantId: "aKIbyE", projectId: "cmuxlajkr000001ngdq0jg9s9" },
	{ grantId: "rnIg2b", projectId: "cmuyymolu02ek01rwjc4g0yfd" },
	{ grantId: "pjIWEy", projectId: "cmuvmlp9500ix01o9fgpfw9it" },
	{ grantId: "KbIZyd", projectId: "cmuut0k7o0a4u01sm099hku6n" },
]

interface Outcome {
	coins: number
	grantId: string
	projectId: string
	reason: string | null
}

/**
 * Pays the cap, in coins, for each grant cancelled before activation. Nothing was spent on these, so the whole cap counts.
 * Skips a project with no tier or grant, a declined grant, or a maker with any admin adjustment already. `?dryRun=true`
 * reports the coins without writing. Re-running pays nothing twice: each maker's total is reconciled to the cap.
 */
export const POST = withIntegrationRoute(async (req: NextRequest) => {
	const dryRun = wantsDryRun(req)
	const projectIds = GRANTS.map(grant => grant.projectId)
	const projects = await db.orm.public.ThemeProject.where(project => project.id.in(projectIds))
		.select("grantUsd", "id", "starterProjectId", "tier", "userId")
		.all()
	const byId = new Map(projects.map(project => [project.id, project]))
	const declined = new Set(
		(
			await db.orm.public.PhaseSubmission.where({ fundingDeclined: true, phase: Phase.DESIGN })
				.where(row => row.themeProjectId.in(projectIds))
				.select("themeProjectId")
				.all()
		).map(row => row.themeProjectId),
	)
	const userIds = [...new Set(projects.map(project => project.userId))]
	const adjusted = new Set(
		(
			await db.orm.public.LedgerEntry.where({ kind: LedgerKind.ADMIN_ADJUSTMENT })
				.where(entry => entry.userId.in(userIds))
				.select("userId")
				.all()
		).map(entry => entry.userId),
	)

	const outcomes: Outcome[] = []
	for (const grant of GRANTS) {
		const project = byId.get(grant.projectId)
		const skip = (reason: string): void => {
			outcomes.push({ coins: 0, grantId: grant.grantId, projectId: grant.projectId, reason })
		}
		if (!project) {
			skip("Project not found")
			continue
		}
		if (declined.has(project.id)) {
			skip("Parts funding was declined")
			continue
		}
		if (adjusted.has(project.userId)) {
			skip("The maker has an admin adjustment, so it is not paid automatically")
			continue
		}
		const capUsd = grantCardCapUsd(project.grantUsd, project.tier, isWeekOneStarter(project.starterProjectId))
		if (capUsd === null || (project.grantUsd ?? 0) <= 0) {
			skip("No tier or approved grant to cap the coins at")
			continue
		}
		const coins = grantReturnCoins(capUsd, 0, 0)
		outcomes.push({ coins, grantId: grant.grantId, projectId: project.id, reason: null })
		if (dryRun) continue
		await db.transaction(async tx => {
			await lockUserCredit(tx, project.userId)
			await reconcileGrant(tx, {
				kind: LedgerKind.GRANT_RETURN_COINS,
				note: `Grant ${grant.grantId} cancelled before activation, paid as coins: $${capUsd} cap, nothing spent`,
				target: coins,
				themeProjectId: project.id,
				userId: project.userId,
			})
		})
	}

	const paid = outcomes.filter(outcome => outcome.reason === null)
	const report = { dryRun, outcomes, totalCoins: paid.reduce((sum, outcome) => sum + outcome.coins, 0) }
	console.info(`[grant-cards-pre-activation-coins] ${JSON.stringify(report)}`)
	return ok({ dryRun, paid: paid.length, skipped: outcomes.length - paid.length, totalCoins: report.totalCoins })
})
