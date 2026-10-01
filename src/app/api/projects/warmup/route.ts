import { after } from "next/server"
import { z } from "zod"
import { Phase, Theme } from "@/app/generated/prisma/enums"
import { markProjectCreated } from "@/lib/analytics"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { WARMUP_THEME } from "@/lib/config/program"
import { requireSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import { boundedText, httpsUrl, phaseSchema } from "@/lib/schemas/common"
import { warmupCreationWindow } from "@/lib/warmup"

export const dynamic = "force-dynamic"

const createSchema = z
	.object({
		title: boundedText(120, 1),
		description: boundedText(4000).optional(),
		githubRepo: httpsUrl.nullable().optional(),
		requestedTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
		/** DESIGN asks for parts funding; BUILD hands in something already built. */
		phase: phaseSchema,
	})
	.strict()

/**
 * Start a warm-up project: any hardware idea, before week 1 opens.
 *
 * A maker may start as many as they like — warm-up rows are exempt from the
 * one-per-theme index — and none of them takes one of the five season slots.
 * Everything after this is the ordinary flow: journal against it, then hand
 * it in once, as the phase chosen here.
 */
export const POST = withRoute(async (req: Request) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const parsed = await parseBody(req, createSchema)
	if (parsed.error) return parsed.error
	const data = parsed.data

	const window = await warmupCreationWindow()
	if (!window.open) {
		return fail("CONFLICT", `Warm-up projects closed ${window.closesOn}.`)
	}

	const project = await prisma.themeProject.create({
		data: {
			userId: gate.user.id,
			theme: Theme.WARMUP,
			title: data.title,
			description: data.description?.trim() || null,
			githubRepo: data.githubRepo ?? null,
			requestedTier: data.requestedTier,
			warmupPhase: data.phase === "BUILD" ? Phase.BUILD : Phase.DESIGN,
		},
		select: { id: true },
	})

	after(() => markProjectCreated(project.id, gate.user.id))
	after(() =>
		logAudit({
			action: AuditAction.USER_UPDATE_PROJECT,
			actorId: gate.user.id,
			actorEmail: gate.user.email,
			targetType: "ThemeProject",
			targetId: project.id,
			metadata: { created: WARMUP_THEME.slug, phase: data.phase, requestedTier: data.requestedTier },
		}),
	)

	return ok({ id: project.id }, { status: 201 })
})
