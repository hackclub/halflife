import { fail, ok } from "@/lib/api"
import { withSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * The closing reels a maker has already posted for one hand-in, newest first.
 *
 * A returned week is handed in again, and the reel that closed it is still up: this is what lets the maker pick it back instead of filming the same walkthrough twice. Scoped to a single submission checkpoint rather than to every reel they own, so a week cannot be handed in on another week's video.
 *
 * `checkpointKey` is validated before it reaches the query. It is written into a `where` clause, and the same pattern the post schema holds to is the one applied here – a malformed key should return nothing, not something unexpected.
 */
const SUBMISSION_KEY = /^(w([1-9]|10)-reel-submission|wu-[A-Za-z0-9_]{1,64}-reel-submission)$/

export const GET = withSession(async (req: Request, { gate }) => {
	const checkpointKey = new URL(req.url).searchParams.get("checkpointKey")
	if (!checkpointKey || !SUBMISSION_KEY.test(checkpointKey))
		return fail("VALIDATION_FAILED", "Not a submission checkpoint")

	const reels = await prisma.post.findMany({
		orderBy: { createdAt: "desc" },
		select: {
			caption: true,
			createdAt: true,
			durationSeconds: true,
			id: true,
			objectKey: true,
			thumbnailKey: true,
		},
		where: { checkpointKey, deletedAt: null, userId: gate.user.id },
	})

	return ok({
		reels: reels.map(reel => ({
			caption: reel.caption,
			createdAt: reel.createdAt.toISOString(),
			durationSeconds: reel.durationSeconds,
			id: reel.id,
			objectKey: reel.objectKey,
			thumbnailUrl: publicUrlFor(reel.thumbnailKey),
			videoUrl: publicUrlFor(reel.objectKey),
		})),
	})
})

export const dynamic = "force-dynamic"
