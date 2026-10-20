import "dotenv/config"
import { appBaseUrl, projectUrl, reviewUrl } from "../src/lib/app-url"
import { ariReviewUrl } from "../src/lib/ari-url"
import { getThemeDef } from "../src/lib/config/program"
import { displayName } from "../src/lib/display-name"
import prisma from "../src/lib/prisma"

/**
 * Every Starbie starter project still waiting on a review, one line each, with the five links needed to work through it.
 *
 * "Unreviewed" is the review queue's own definition: a project with at least one `PhaseSubmission` whose `resolvedAt` is null. A project whose design was decided but whose build has not been handed in is therefore absent, and a resubmission after "needs changes" puts it back. Deleted projects are excluded for the same reason they are absent from the queue.
 *
 * The links are, in order:
 *
 * - the project's page as a maker sees it (`/projects/<id>`);
 * - its hand-in in the review console (`/review/<submission id>`) – one URL per open phase, so a project that somehow has both a design and a build open gets two;
 * - the maker's public profile (`/u/<user id>`);
 * - the maker's admin profile (`/admin/users/<user id>`);
 * - the hand-in's review screen on Ari (`/p/<program>/review/<ship id>`), when Ari is configured and the hand-in reached it – `-` otherwise.
 *
 * Output is tab-separated with a header row, so it pastes straight into a spreadsheet; the summary goes to stderr and stays out of a redirected file. Read-only, and safe to run against production:
 *
 *   bun --conditions=react-server scripts/list-unreviewed-starbies.ts
 *   bun --conditions=react-server scripts/list-unreviewed-starbies.ts > starbies.tsv
 *
 * In production run it where `DATABASE_URL` points at the live database (the Orchard pod, not a dev machine).
 */

/** The starter's id in lib/config/onboarding; this is what onboarding wrote on the project when it was taken. */
const STARTER_PROJECT_ID = "starbie"

/** Tabs and newlines would break the one-line-per-project shape; a title with either reads the same with a space in its place. */
function oneLine(value: string): string {
	return value.replaceAll(/[\t\r\n]+/g, " ").trim()
}

async function main() {
	const projects = await prisma.themeProject.findMany({
		select: {
			id: true,
			submissions: {
				orderBy: { createdAt: "asc" },
				select: { ariSubmissionId: true, createdAt: true, id: true, phase: true },
				where: { resolvedAt: null },
			},
			theme: true,
			title: true,
			user: { select: { displayName: true, id: true, name: true } },
		},
		where: {
			deletedAt: null,
			starterProjectId: STARTER_PROJECT_ID,
			submissions: { some: { resolvedAt: null } },
		},
	})

	// Oldest hand-in first, the queue's own order: the people who have been waiting longest are the ones to look at first.
	const ordered = projects
		.map(project => ({ project, waitingSince: project.submissions[0]?.createdAt ?? new Date(0) }))
		.toSorted((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime())

	const base = appBaseUrl()
	console.log(
		["maker", "project", "theme", "phase", "waiting since", "page", "review", "profile", "admin", "ari"].join("\t"),
	)

	for (const { project, waitingSince } of ordered) {
		const reviewLinks = project.submissions.map(submission => reviewUrl(submission.id))
		const ariLinks = project.submissions
			.map(submission => (submission.ariSubmissionId ? ariReviewUrl(submission.ariSubmissionId) : null))
			.filter(link => link !== null)
		console.log(
			[
				displayName(project.user, "—"),
				project.title || project.id,
				getThemeDef(project.theme).label,
				project.submissions.map(submission => submission.phase.toLowerCase()).join(", "),
				waitingSince.toISOString(),
				projectUrl(project.id),
				reviewLinks.join(" "),
				`${base}/u/${project.user.id}`,
				`${base}/admin/users/${project.user.id}`,
				ariLinks.length > 0 ? ariLinks.join(" ") : "-",
			]
				.map(value => oneLine(value))
				.join("\t"),
		)
	}

	const oldest = ordered[0]?.waitingSince
	console.error(
		`${ordered.length} unreviewed Starbie project(s)${oldest ? `, oldest waiting since ${oldest.toISOString()}` : ""}`,
	)
}

main()
	.catch(err => {
		console.error(err)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
