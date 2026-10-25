import "dotenv/config"
import { or } from "@prisma/orm-postgres/orm-client"
import { PhaseStatus } from "../src/lib/enums"
import db from "../src/lib/prisma8"
import { returnExtensionUntil } from "../src/lib/review"
import { formatDbTimestamp, parseDbTimestamp } from "../src/lib/time"

/**
 * Give the projects already sitting on "needs changes" the week a return now grants.
 *
 * The grant added to `finalizeReview` (and to an admin's un-approve/reopen) only fires on the decision itself, so a project returned before it existed is left as it was: its maker was asked to fix something and may no longer be able to hand it in, because the week has since closed. This walks the projects whose design or build is still `update_requested` – the ones a maker is expected to act on right now – and writes the same week onto each.
 *
 * Only the project carries the extension, matching the live path, so a run reopens just those projects' weeks and nothing on the account. A project with an extension already running is left alone: an admin set that on purpose, and this is not the place to shorten or stretch it. That is also what makes a re-run safe – every project this touches is, by then, extended into the future.
 *
 * Read-only unless `--commit` is passed. Run it where `DATABASE_URL` points at the real database (the Orchard pod, not a dev machine):
 *
 *   bun --conditions=react-server scripts/backfill-return-extensions.ts
 *   bun --conditions=react-server scripts/backfill-return-extensions.ts --commit
 */

const commit = process.argv.includes("--commit")

/** Which phase of a project is waiting on the maker, for the log line. */
function waitingPhases(project: { buildStatus: PhaseStatus; designStatus: PhaseStatus }): string[] {
	const phases: string[] = []
	if (project.designStatus === PhaseStatus.update_requested) phases.push("design")
	if (project.buildStatus === PhaseStatus.update_requested) phases.push("build")
	return phases
}

async function main() {
	const now = new Date()
	const candidates = await db.orm.public.ThemeProject.where({ deletedAt: null })
		.where(project =>
			or(project.designStatus.eq(PhaseStatus.update_requested), project.buildStatus.eq(PhaseStatus.update_requested)),
		)
		.select("buildStatus", "designStatus", "id", "submissionExtensionUntil", "theme", "title")
		.include("user", user => user.select("email"))
		.all()

	// No extension running (none at all, or one that has already lapsed): the only projects with something to give back.
	const blocked = candidates.filter(
		p => !p.submissionExtensionUntil || parseDbTimestamp(p.submissionExtensionUntil) <= now,
	)
	console.log(`projects on "needs changes": ${candidates.length}`)
	console.log(`already extended, left alone: ${candidates.length - blocked.length}`)
	console.log(`to extend by a week: ${blocked.length}`)

	if (blocked.length === 0) return

	for (const project of blocked) {
		const current = project.submissionExtensionUntil ? parseDbTimestamp(project.submissionExtensionUntil) : null
		const until = returnExtensionUntil(current, now)
		console.log(
			`${commit ? "extend" : "would extend"} ${project.theme}/${project.title ?? project.id} (${project.user?.email ?? "no owner"}): ${waitingPhases(project).join(", ")} until ${until.toISOString()}`,
		)
	}

	if (!commit) {
		console.log("Dry run. Pass --commit to write these.")
		return
	}

	// One statement for the set, and the conditions are re-checked inside it: a project that was resubmitted, or handed a longer extension, between the read above and this write falls out of the `where` rather than being overwritten. Every row lands on the same instant, so a single value is enough.
	const written = await db.orm.public.ThemeProject.where({ deletedAt: null })
		.where(project => project.id.in(blocked.map(p => p.id)))
		.where(project =>
			or(project.designStatus.eq(PhaseStatus.update_requested), project.buildStatus.eq(PhaseStatus.update_requested)),
		)
		.where(project =>
			or(project.submissionExtensionUntil.isNull(), project.submissionExtensionUntil.lte(formatDbTimestamp(now))),
		)
		.updateAndCount({ submissionExtensionUntil: formatDbTimestamp(returnExtensionUntil(null, now)) })
	console.log(`extended ${written} project(s)`)
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exitCode = 1
} finally {
	await db.close()
}
