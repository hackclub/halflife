import "server-only"
import type { ThemeProject } from "@/app/generated/prisma/client"
import type { Theme } from "@/app/generated/prisma/enums"
import { THEMES } from "@/lib/config/program"
import prisma from "@/lib/prisma"

/**
 * Create one themed project row, when its week's "create a project" checkpoint is opened – never ahead of time.
 *
 * Rows used to be made for all five themes at sign-up. Most people do not reach week five (the program expects steep drop-off between weeks), so that filled the table with projects nobody started and made "has a project" mean nothing. A row now exists only once someone has gone to make it.
 *
 * Idempotent: the `(userId, theme)` unique constraint plus `skipDuplicates` means opening the checkpoint twice, or two tabs racing, is still one row. Resolves to the row either way.
 */
export async function ensureThemeProject(userId: string, theme: Theme): Promise<ThemeProject> {
	const def = THEMES.find((t) => t.id === theme)
	if (!def) throw new Error(`Unknown theme ${theme}`)

	// Most onboarding reads happen after the row already exists. Avoid a pointless write/round-trip on that hot path; the unique constraint still makes the create branch safe when two tabs open the checkpoint together.
	const existing = await prisma.themeProject.findFirst({
		where: { userId, theme, deletedAt: null },
	})
	if (existing) return existing

	await prisma.themeProject.createMany({
		data: [{ userId, theme, title: def.label }],
		skipDuplicates: true,
	})
	return prisma.themeProject.findFirstOrThrow({
		where: { userId, theme, deletedAt: null },
	})
}

/** The theme a design week belongs to, or null for a week that is not one. */
export function themeForDesignWeek(weekId: number): Theme | null {
	return THEMES.find((t) => t.designWeek === weekId)?.id ?? null
}
