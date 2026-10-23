import { after } from "next/server"
import { z } from "zod"
import { Phase } from "@/app/generated/prisma/enums"
import { markProjectCreated } from "@/lib/analytics"
import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { WARMUP_THEME } from "@/lib/config/program"
import { withSession } from "@/lib/guards"
import { createWarmupProject } from "@/lib/provisioning"
import { boundedText, httpsUrl, phaseSchema } from "@/lib/schemas/common"
import { warmupCreationWindow } from "@/lib/warmup"

const createSchema = z
	.object({
		description: boundedText(4000).optional(),
		githubRepo: httpsUrl.nullable().optional(),
		/** DESIGN asks for parts funding; BUILD hands in something already built. */
		phase: phaseSchema,
		requestedTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
		title: boundedText(120, 1),
	})
	.strict()

/**
 * Start a warm-up project: any hardware idea, before week 1 opens.
 *
 * A maker may start several – warm-up rows are exempt from the one-per-theme index – and none of them takes one of the five season slots. How many is capped, though: a warm-up handed in as a design is approved like any other and carries a real parts grant, so the number of them is the number of grants. The cap is on that budget, not on the ideas (see MAX_WARMUP_PROJECTS).
 *
 * Everything after this is the ordinary flow: journal against it, then hand it in once, as the phase chosen here.
 */
export const POST = withSession(async (req: Request, { gate }) => {
	const parsed = await parseBody(req, createSchema)
	if (parsed.error) return parsed.error
	const { data } = parsed

	const window = await warmupCreationWindow()
	if (!window.open) return fail("CONFLICT", `Warm-up projects closed ${window.closesOn}.`)

	const project = await createWarmupProject({
		description: data.description?.trim() || null,
		githubRepo: data.githubRepo ?? null,
		requestedTier: data.requestedTier,
		title: data.title,
		userId: gate.user.id,
		warmupPhase: data.phase === "BUILD" ? Phase.BUILD : Phase.DESIGN,
	})

	after(() => markProjectCreated(project.id, gate.user.id))
	after(() =>
		logAudit({
			action: AuditAction.USER_UPDATE_PROJECT,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: { created: WARMUP_THEME.slug, phase: data.phase, requestedTier: data.requestedTier },
			targetId: project.id,
			targetType: "ThemeProject",
		}),
	)

	return ok({ id: project.id }, { status: 201 })
})

export const dynamic = "force-dynamic"
