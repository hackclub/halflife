import type { NextRequest } from "next/server"
import { fail, ok, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { verifyOwnTimelapses } from "@/lib/lapse"
import prisma from "@/lib/prisma"
import { MAX_CLIP_REF_LENGTH } from "@/lib/schemas/session"

export const dynamic = "force-dynamic"

/**
 * Turn stored clip refs back into picker items, for editing an entry.
 *
 * The journal sheet only keeps clip ids; the picker needs the full item, and deciding what each id still means needs the database. Ids this session claimed on Lapse that still verify come back `resolved`. Ones Lapse no longer vouches for – gone private, deleted, still processing – come back `pinned`: the edit keeps them without re-checking, so touching the words does not drop the evidence. Anything else (older R2 uploads) comes back `legacy` and is never touched at all.
 *
 * `forSession` names the session being edited and must be theirs: otherwise one maker could probe another's attachments a guess at a time.
 */
export const GET = withRoute(async (req: NextRequest) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const params = req.nextUrl.searchParams
	const ids = (params.get("ids") ?? "")
		.split(",")
		.map(s => s.trim())
		.filter(Boolean)
		// How many this reads, not how many an entry may hold: each one costs a round trip to Lapse, so the number is bounded even though the session schema no longer is. The sheet keeps whatever is left over pinned by id rather than dropping it, so stopping here costs a row in the picker, not a clip.
		.slice(0, 25)
	if (ids.length === 0) return fail("VALIDATION_FAILED", "Name the timelapses to resolve")
	if (ids.some(id => id.length > MAX_CLIP_REF_LENGTH))
		return fail("VALIDATION_FAILED", "Those timelapses could not be read")

	const forSession = params.get("forSession") ?? undefined
	let ownExternalIds = new Set<string>()
	if (forSession) {
		const session = await prisma.workSession.findFirst({
			where: { id: forSession, deletedAt: null, themeProject: { userId: gate.user.id, deletedAt: null } },
			select: { id: true },
		})
		if (!session) return fail("NOT_FOUND", "Session not found")
		const rows = await prisma.sessionTimelapse.findMany({
			where: { workSessionId: forSession, provider: "lapse", externalId: { in: ids } },
			select: { externalId: true },
		})
		ownExternalIds = new Set(rows.flatMap(r => (r.externalId ? [r.externalId] : [])))
	}

	const resolved: {
		id: string
		title: string
		durationSeconds: number
		visibility: "PUBLIC" | "UNLISTED" | "FAILED_PROCESSING"
		createdAt: number
		thumbnailUrl: string | null
		hackatimeProject: string | null
		processing: boolean
		attached: boolean
	}[] = []
	const pinned: string[] = []
	const legacy: string[] = []

	for (const id of ids) {
		// Never theirs on Lapse: an older upload, kept as it is.
		if (!ownExternalIds.has(id)) {
			legacy.push(id)
			continue
		}
		try {
			const [t] = await verifyOwnTimelapses(gate.user.id, [id])
			if (!t) {
				pinned.push(id)
				continue
			}
			resolved.push({
				id: t.id,
				title: t.title,
				durationSeconds: t.durationSeconds,
				visibility: t.visibility,
				createdAt: t.createdAt,
				thumbnailUrl: t.thumbnailUrl,
				hackatimeProject: t.hackatimeProject,
				processing: t.playbackUrl === null,
				// About to be selected, which is what unblocks a picked row – the flag only ever stops somebody else's clip.
				attached: false,
			})
		} catch {
			pinned.push(id)
		}
	}

	return ok({ resolved, pinned, legacy })
})
