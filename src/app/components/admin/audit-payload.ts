/**
 * The audit log records `{ before, after }` for a change and free-form keys beside it (`reason`, `phase`, `submissionId`). This turns one stored payload into the two things the console shows: the fields that actually changed, and the rest of the detail worth reading.
 *
 * The helpers are deliberately unaware of React: the page renders one row per entry and can test this part on its own.
 */

export interface AuditChange {
	/** The new value, or undefined when the payload recorded only the old one. */
	after: unknown
	/** The old value, or undefined when the payload recorded only the new one. */
	before: unknown
	field: string
}

export interface AuditField {
	key: string
	value: unknown
}

export interface AuditPayload {
	changes: AuditChange[]
	/** Every top-level key that is not part of the before/after pair. */
	fields: AuditField[]
}

/** Shown for a side of a change the payload never recorded, as distinct from a recorded null. */
const ABSENT = "–"

const MAX_COMPACT_LENGTH = 60

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** JSON equality is enough here: the payload comes from the database, so it has no dates, classes or cycles. */
function sameValue(a: unknown, b: unknown): boolean {
	if (a === undefined || b === undefined) return a === b
	return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * A before/after pair becomes one row per changed field; a scalar pair (`{ before: true, after: false }`) becomes a single "value" row. Unchanged fields are dropped: the question a reader has is what moved, not what stayed still.
 */
function changesBetween(before: unknown, after: unknown): AuditChange[] {
	const beforeObject = isPlainObject(before) ? before : undefined
	const afterObject = isPlainObject(after) ? after : undefined
	const bothObjects = beforeObject && afterObject
	const oneSideMissing = before === undefined || after === undefined

	if (bothObjects || (oneSideMissing && (beforeObject || afterObject))) {
		const oldValues = beforeObject ?? {}
		const newValues = afterObject ?? {}
		// New keys first, then the ones that were removed.
		const fields = [...Object.keys(newValues), ...Object.keys(oldValues).filter(field => !(field in newValues))]
		return fields
			.filter(field => !sameValue(oldValues[field], newValues[field]))
			.map(field => ({ after: newValues[field], before: oldValues[field], field }))
	}

	if (sameValue(before, after)) return []
	return [{ after, before, field: "value" }]
}

export function auditPayload(metadata: unknown): AuditPayload {
	if (!isPlainObject(metadata)) {
		const hasValue = metadata !== null && metadata !== undefined
		return { changes: [], fields: hasValue ? [{ key: "payload", value: metadata }] : [] }
	}

	const fields: AuditField[] = []
	for (const [key, value] of Object.entries(metadata))
		if (key !== "before" && key !== "after") fields.push({ key, value })

	return { changes: changesBetween(metadata.before, metadata.after), fields }
}

/** Values JSON cannot carry never reach the audit log, but a payload typed as unknown may still hold one. */
function fallbackText(value: unknown): string {
	if (typeof value === "bigint") return value.toString()
	if (typeof value === "symbol") return value.description ?? "symbol"
	if (typeof value === "function") return "function"
	return "null"
}

/** A value as the expanded view shows it: strings as they are, collections as indented JSON. */
export function formatAuditValue(value: unknown): string {
	if (value === undefined) return ABSENT
	if (value === null) return "null"
	if (typeof value === "string") return value === "" ? '""' : value
	if (typeof value === "number" || typeof value === "boolean") return String(value)
	try {
		return JSON.stringify(value, null, 2) ?? fallbackText(value)
	} catch {
		return fallbackText(value)
	}
}

/** The same value on one line, for the summary that has to fit in a table cell. */
export function formatAuditCompact(value: unknown, limit = MAX_COMPACT_LENGTH): string {
	let text: string
	if (value === undefined) text = ABSENT
	else if (value === null) text = "null"
	else if (typeof value === "string") text = value === "" ? '""' : value
	else if (typeof value === "number" || typeof value === "boolean") text = String(value)
	else
		try {
			text = JSON.stringify(value) ?? fallbackText(value)
		} catch {
			text = fallbackText(value)
		}

	const oneLine = text.replaceAll(/\s+/g, " ").trim()
	return oneLine.length > limit ? `${oneLine.slice(0, limit - 1)}…` : oneLine
}
