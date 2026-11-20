import { z } from "zod"
import { fieldKey, YSWS_SUBMISSION } from "@/lib/airtable/schema"

/**
 * What an admin changed at T2, kept on the approval (`SubmissionReview.unifiedOverrides`) and laid over every later write of the row.
 *
 * Fabricate keeps the same thing on the ship for the same reason: the row is rewritten after hand-in – an admin's refresh, a resubmission's sync – from Half Life's own records, and without the overrides those writes would quietly put back the address, hours or justification the admin had corrected before sending the project to the unified database. Only the fields that differ from what Half Life generates are kept, so a fix to the generated value (a maker updating their address, say) still flows through every field the admin left alone.
 *
 * Separate from lib/airtable/unified-review so the row writer in lib/airtable/sync can read it without importing the T2 screen's own queries, which import the row writer.
 */

/** The columns T2 lets an admin change, in the order the form lays them out. Keys of `YSWS_SUBMISSION.fields`. */
export const UNIFIED_EDITABLE = Object.freeze([
	"codeUrl",
	"playableUrl",
	"firstName",
	"lastName",
	"email",
	"birthday",
	"addressLine1",
	"addressLine2",
	"city",
	"state",
	"zip",
	"country",
	"overrideHoursSpent",
	"description",
	"overrideHoursSpentJustification",
	"githubUsername",
	"slackId",
] as const)

export type UnifiedFieldKey = (typeof UNIFIED_EDITABLE)[number]

/** How many screenshots the unified database takes, as on Fabricate. */
export const MAX_SCREENSHOTS = 3

export const isUnifiedFieldKey = (key: string): key is UnifiedFieldKey =>
	(UNIFIED_EDITABLE as readonly string[]).includes(key)

/** One value per editable column as the form holds it: text, with the hours as the text of a number. */
export type UnifiedFieldValues = { [_ in UnifiedFieldKey]: string }

export interface UnifiedOverrides {
	fields: { [_: string]: string }
	/** The screenshots in order, the first being the cover. Absent when the admin kept the generated ones. */
	screenshots?: string[]
}

const OverridesSchema = z.object({
	fields: z.record(z.string(), z.string()).default({}),
	screenshots: z.array(z.string()).optional(),
})

/** The stored overrides, or none for a review T2 never saved (or a value that no longer parses, which is treated the same rather than breaking every write of the row). */
export function parseUnifiedOverrides(value: unknown): UnifiedOverrides {
	const parsed = OverridesSchema.safeParse(value ?? {})
	if (!parsed.success) return { fields: {} }
	const fields: { [_: string]: string } = {}
	for (const [key, text] of Object.entries(parsed.data.fields)) if (isUnifiedFieldKey(key)) fields[key] = text
	return parsed.data.screenshots ? { fields, screenshots: parsed.data.screenshots } : { fields }
}

/** The hours cell from its text: a number rounded as the base shows it, or null to clear. */
export function hoursCell(text: string): number | null {
	if (text.trim() === "") return null
	const hours = Number(text)
	return Number.isFinite(hours) && hours >= 0 ? Math.round(hours * 100) / 100 : null
}

/** One column's cell from the form's text: the hours as a number, everything else as trimmed text. */
export const unifiedCell = (key: UnifiedFieldKey, text: string): string | number | null =>
	key === "overrideHoursSpent" ? hoursCell(text) : text.trim()

/** The Airtable cells the overrides stand for, keyed as the row writer keys them. */
export function overrideCells(overrides: UnifiedOverrides): { [_: string]: unknown } {
	const cells: { [_: string]: unknown } = {}
	for (const [key, text] of Object.entries(overrides.fields)) {
		if (!isUnifiedFieldKey(key)) continue
		cells[fieldKey(YSWS_SUBMISSION.fields[key])] = unifiedCell(key, text)
	}
	if (overrides.screenshots)
		cells[fieldKey(YSWS_SUBMISSION.fields.screenshot)] = overrides.screenshots.map(url => ({ url }))
	return cells
}
