import { Phase } from "@/app/generated/prisma/enums"

/**
 * The `external_id` Half Life gives Ari.
 *
 * Leadership decided one Ari ship per (project, phase), so the id carries both: `<themeProjectId>:design` / `:build`. This is deliberately a pure module with no server imports, so `verify:contracts` can pin the format without loading the database layer.
 */

function ariExternalId(themeProjectId: string, phase: Phase): string {
	return `${themeProjectId}:${phase === Phase.DESIGN ? "design" : "build"}`
}

/** The inverse of `ariExternalId`, or null for anything else. */
function parseAriExternalId(externalId: string): { themeProjectId: string; phase: Phase } | null {
	const at = externalId.lastIndexOf(":")
	if (at <= 0) return null
	const suffix = externalId.slice(at + 1)
	if (suffix !== "design" && suffix !== "build") return null
	return { phase: suffix === "design" ? Phase.DESIGN : Phase.BUILD, themeProjectId: externalId.slice(0, at) }
}

export { ariExternalId, parseAriExternalId }
