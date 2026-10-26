import "server-only"
import type { Models } from "@/app/generated/prisma8/contract.d"
import { MAX_WARMUP_PROJECTS, THEMES } from "@/lib/config/program"
import { type Phase, Theme } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { lockKey } from "@/lib/locks"
import db, { type DbOrTx } from "@/lib/prisma8"

/**
 * Create one themed project row, when its week's "create a project" checkpoint is opened – never ahead of time.
 *
 * Rows used to be made for all five themes at sign-up. Most people do not reach week five (the program expects steep drop-off between weeks), so that filled the table with projects nobody started and made "has a project" mean nothing. A row now exists only once someone has gone to make it.
 *
 * Idempotent: the `(userId, theme)` unique constraint plus `skipDuplicates` means opening the checkpoint twice, or two tabs racing, is still one row. Resolves to the row either way.
 */
/** One project row as reads return it: scalars only, no relations loaded. */
export type ThemeProjectRow = Omit<
	Models.public_ThemeProject,
	| "user"
	| "posts"
	| "workSessions"
	| "submissions"
	| "hcbGrantTopUps"
	| "hackatimeLinks"
	| "contentReports"
	| "publicReels"
	| "ledgerEntries"
	| "bomItems"
	| "repoSyncRuns"
	| "reports"
>

export async function ensureThemeProject(userId: string, theme: Theme): Promise<ThemeProjectRow> {
	const def = THEMES.find(t => t.id === theme)
	if (!def) throw new Error(`Unknown theme ${theme}`)

	// Most onboarding reads happen after the row already exists. Avoid a pointless write/round-trip on that hot path; the unique constraint still makes the create branch safe when two tabs open the checkpoint together.
	const existing = await db.orm.public.ThemeProject.where({ deletedAt: null, theme, userId }).first()
	if (existing) return existing

	await db.orm.public.ThemeProject.createAll([{ theme, title: def.label, userId }], { onConflict: "skip" })
	return db.orm.public.ThemeProject.where({ deletedAt: null, theme, userId }).firstOrThrow()
}

/**
 * Serialize warm-up creation for one maker.
 *
 * The cap is a count, and a count read before the create is a race: two requests at once both read a count under the cap and both create, so the cap would be a suggestion rather than a cap. The lock is the same per-maker advisory lock the money paths take (see `lockUserCredit` in lib/currency.ts), in its own namespace so it cannot collide with a credit mutation, and it is the first statement in the transaction so the count cannot be read before the other request has finished creating.
 */
function lockWarmupProjects(tx: DbOrTx, userId: string): Promise<void> {
	return lockKey(tx, `warmup:${userId}`)
}

export interface WarmupProjectInput {
	description: string | null
	githubRepo: string | null
	requestedTier: number
	title: string
	userId: string
	warmupPhase: Phase
}

/**
 * Start a warm-up project, if this maker is under the cap.
 *
 * Warm-up rows are exempt from the one-per-theme index on purpose – a maker may try more than one idea, and none of them takes a season slot – but each one that is handed in as a design and approved carries a real parts grant. So the number of warm-up rows a maker may hold is capped, and the cap is on the grant budget rather than on the ideas (see MAX_WARMUP_PROJECTS).
 *
 * The count and the create are one transaction under a per-maker lock, so two requests at once cannot both slip past the cap.
 */
export function createWarmupProject(input: WarmupProjectInput): Promise<ThemeProjectRow> {
	return db.transaction(async tx => {
		await lockWarmupProjects(tx, input.userId)

		// Only the rows that still exist count. A warm-up that has been approved, funded or earned a coin cannot be deleted at all (see `deleteBlockReason`), so a project that could carry a grant is always in this count: deleting a draft never buys another one.
		const { count: existing } = await tx.orm.public.ThemeProject.where({
			deletedAt: null,
			theme: Theme.WARMUP,
			userId: input.userId,
		}).aggregate(a => ({ count: a.count() }))
		if (existing >= MAX_WARMUP_PROJECTS)
			throw new HttpError(
				"CONFLICT",
				`You already have ${MAX_WARMUP_PROJECTS} warm-up projects. Delete one to start another.`,
			)

		return tx.orm.public.ThemeProject.create({
			description: input.description,
			githubRepo: input.githubRepo,
			requestedTier: input.requestedTier,
			theme: Theme.WARMUP,
			title: input.title,
			userId: input.userId,
			warmupPhase: input.warmupPhase,
		})
	})
}
