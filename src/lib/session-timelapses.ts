import "server-only"
import type { Prisma } from "@/app/generated/prisma/client"
import { HttpError } from "@/lib/errors"
import { lockKey } from "@/lib/locks"

type Tx = Prisma.TransactionClient

export interface FreshTimelapse {
	durationSeconds: number
	/** The Hackatime project Lapse had synced when this was recorded, if any. */
	hackatimeProject: string | null
	id: string
	playbackUrl: string | null
	/**
	 * When the recording STARTED, Lapse's createdAt (epoch ms).
	 *
	 * Stored because without it a timelapse is a duration with no date, and a duration cannot be compared against Hackatime's tracked intervals – which is the whole basis for not paying twice for the same sitting. Read back from Lapse at attach time rather than later, because Lapse answers on the caller's own OAuth token and that token expires.
	 */
	recordedAt: number | null
	thumbnailUrl: string | null
	title: string
}

/**
 * Bring a session's Lapse attachments to the desired set.
 *
 * Ids already on the session stay untouched; brand-new ones are created from the just-verified metadata; lapse rows for anything else come off. Older R2 rows predate Lapse and are never touched. A clip claimed by another live session refuses with the same conflict the create path reports – re-homing must not let one recording back two entries.
 *
 * Runs inside the caller's transaction: the advisory locks serialize against concurrent attaches of the same recording, exactly as creation does.
 */
export async function reconcileSessionTimelapses(
	tx: Tx,
	sessionId: string,
	want: string[],
	fresh: FreshTimelapse[],
): Promise<{ added: string[]; removed: string[] }> {
	const rows = await tx.sessionTimelapse.findMany({
		select: { externalId: true, id: true, provider: true },
		where: { workSessionId: sessionId },
	})
	const have = new Set(rows.flatMap(r => (r.provider === "lapse" && r.externalId ? [r.externalId] : [])))
	const removeIds = rows
		.filter(r => r.provider === "lapse" && r.externalId && !want.includes(r.externalId))
		.map(r => r.id)
	const addIds = want.filter(id => !have.has(id))
	const adding = fresh.filter(t => addIds.includes(t.id))

	for (const lapseId of [...addIds].toSorted()) await lockKey(tx, `lapse:${lapseId}`)

	if (addIds.length > 0) {
		// This session's own rows do not count: keeping a clip is not taking it from anywhere.
		const taken = await tx.sessionTimelapse.findFirst({
			select: { externalId: true },
			where: {
				externalId: { in: addIds },
				provider: "lapse",
				workSession: { deletedAt: null, themeProject: { deletedAt: null } },
				workSessionId: { not: sessionId },
			},
		})
		if (taken) {
			const title = fresh.find(t => t.id === taken.externalId)?.title ?? "That timelapse"
			throw new HttpError("CONFLICT", `"${title}" already backs another journal entry`)
		}
	}
	if (removeIds.length > 0) await tx.sessionTimelapse.deleteMany({ where: { id: { in: removeIds } } })

	if (adding.length > 0)
		await tx.sessionTimelapse.createMany({
			data: adding.map(t => ({
				coveredSeconds: t.durationSeconds,
				externalId: t.id,
				hackatimeProject: t.hackatimeProject,
				playbackUrl: t.playbackUrl,
				provider: "lapse",
				// The recording's own start, and the project Lapse saw while it ran, so the hours rollup can intersect this window with Hackatime's spans instead of paying for the same sitting twice.
				recordedAt: t.recordedAt === null ? null : new Date(t.recordedAt),
				thumbnailUrl: t.thumbnailUrl,
				workSessionId: sessionId,
			})),
		})

	return { added: adding.map(t => t.id), removed: removeIds }
}
