/* oxlint-disable import/group-exports -- Next.js reads segment config exports statically */

import { fail, ok, parseBody } from "@/lib/api"
import { type AuthedContext, withSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import { PLATFORM_INFO, readPublicReelLink } from "@/lib/public-reels"
import { publicReelLinksSchema } from "@/lib/schemas/feed"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Record where a Half Life reel was also posted publicly – one Public Reels row per link – so a post that goes viral can be found and paid for.
 *
 * Only the reel's author can add links to it. Each link is checked against its platform and stored in its tidy form (lib/public-reels.ts), which is also what makes a post claimable once: the same link sent again by its owner is accepted and not duplicated, and a link someone else already added is refused. Nothing is written unless every link passes, so a typo in one field never leaves the others half saved.
 */
export const POST = withSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const parsed = await parseBody(req, publicReelLinksSchema)
	if (parsed.error) return parsed.error

	const post = await prisma.post.findFirst({
		select: { id: true, themeProjectId: true },
		where: { deletedAt: null, id, userId: gate.user.id },
	})
	if (!post) return fail("NOT_FOUND", "Reel not found")

	const links: { platform: keyof typeof PLATFORM_INFO; url: string }[] = []
	const errors: { [_: string]: string } = {}
	for (const link of parsed.data.links) {
		const read = readPublicReelLink(link.platform, link.url)
		if ("error" in read) errors[link.platform] = read.error
		else links.push({ platform: link.platform, url: read.url })
	}

	const taken = await prisma.publicReel.findMany({
		select: { url: true, userId: true },
		where: { url: { in: links.map(l => l.url) } },
	})
	for (const row of taken) {
		const link = links.find(l => l.url === row.url)
		if (link && row.userId !== gate.user.id)
			errors[link.platform] = `That ${PLATFORM_INFO[link.platform].label} post has already been added by someone else.`
	}
	if (Object.keys(errors).length > 0)
		return fail("VALIDATION_FAILED", Object.values(errors)[0] ?? "Check your links", { fields: errors })

	const mine = new Set(taken.map(t => t.url))
	const fresh = links.filter(l => !mine.has(l.url))
	if (fresh.length > 0)
		await prisma.publicReel.createMany({
			data: fresh.map(l => ({
				email: gate.user.email,
				platform: l.platform,
				postId: post.id,
				themeProjectId: post.themeProjectId,
				url: l.url,
				userId: gate.user.id,
			})),
			// Two tabs sending the same link at once: the unique url settles it.
			skipDuplicates: true,
		})

	return ok({ saved: links.length }, { status: 201 })
})

export const dynamic = "force-dynamic"
