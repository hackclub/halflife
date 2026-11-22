import "server-only"
import { AirtableListSchema, airtableFetch, escapeAirtableValue, withRateLimitRetry } from "@/lib/airtable/client"

/**
 * Whether a project is already in the unified database, by its code or playable URL – Fabricate's `UnifiedDuplicateCheck`, read from the same Approved Projects table Half Life already deletes from on an unsubmit (`AIRTABLE_UNIFIED_BASE_ID`, `AIRTABLE_UNIFIED_APPROVED_TABLE`).
 *
 * T2 shows it before an admin sends a project on, because the unified database pays for a project once across every YSWS: a repository that is already there under another program is the case to stop for. A build matching its own design under Half Life is expected.
 */

/** How the program's projects are named in the unified database's `YSWS–Name` column. */
const PROGRAM = "Half Life"

const FIELDS = Object.freeze(["Code URL", "Playable URL", "YSWS–Name", "Approved At", "Email - Trimmed & Lowercased"])

/** Hosts whose URLs name a repository by owner and name: anything after those two segments is a path inside it. */
const REPO_HOSTS = Object.freeze(["github.com", "gitlab.com", "codeberg.org", "bitbucket.org"])

/** Enough records to say "already there"; a URL that matches more than this is matching something far too broad. */
const MAX_RECORDS = 50

export interface UnifiedMatch {
	approvedAt: string | null
	codeUrl: string | null
	playableUrl: string | null
	sameMaker: boolean
	sameProgram: boolean
	ysws: string
}

export type UnifiedCheck =
	| { configured: false }
	| { configured: true; error: string }
	| { configured: true; matches: UnifiedMatch[] }

/**
 * A URL reduced to what identifies the project: host without `www.`, and the path lowercased – only owner and name on a forge, without `.git`. Null for anything that is not an http(s) URL with a path.
 */
export function unifiedUrlKey(url: string | null | undefined): string | null {
	let parsed: URL
	try {
		parsed = new URL((url ?? "").trim())
	} catch {
		return null
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
	const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
	const all = parsed.pathname.toLowerCase().split("/").filter(Boolean)
	const segments = REPO_HOSTS.includes(host) ? all.slice(0, 2) : all
	const lastIndex = segments.length - 1
	const last = segments[lastIndex]
	if (last === undefined) return null
	segments[lastIndex] = last.replace(/\.git$/, "")
	return [host, ...segments].join("/")
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null)

/** The unified database's approved projects that share this hand-in's code or playable URL. */
export async function checkUnified(opts: {
	codeUrl: string
	email: string
	playableUrl: string
}): Promise<UnifiedCheck> {
	// A key of its own when there is one: Half Life's own key can't read the unified base.
	const apiKey = process.env.AIRTABLE_UNIFIED_API_KEY || process.env.AIRTABLE_API_KEY
	const baseId = process.env.AIRTABLE_UNIFIED_BASE_ID
	const table = process.env.AIRTABLE_UNIFIED_APPROVED_TABLE
	if (!apiKey || !baseId || !table) return { configured: false }

	const keys = [...new Set([unifiedUrlKey(opts.codeUrl), unifiedUrlKey(opts.playableUrl)])].filter(
		(key): key is string => key !== null,
	)
	if (keys.length === 0) return { configured: true, matches: [] }

	const formula = `OR(${keys
		.flatMap(key => {
			const value = escapeAirtableValue(key)
			return [`FIND("${value}", LOWER({Code URL}))`, `FIND("${value}", LOWER({Playable URL}))`]
		})
		.join(", ")})`
	const fields = FIELDS.map(field => `fields[]=${encodeURIComponent(field)}`).join("&")
	try {
		const page = await withRateLimitRetry("checkUnifiedDuplicates", () =>
			airtableFetch(
				AirtableListSchema,
				{ apiKey, baseId },
				`${table}?${fields}&pageSize=${MAX_RECORDS}&filterByFormula=${encodeURIComponent(formula)}`,
			),
		)
		const email = opts.email.trim().toLowerCase()
		const matches: UnifiedMatch[] = []
		for (const record of page.records) {
			const codeUrl = text(record.fields["Code URL"])
			const playableUrl = text(record.fields["Playable URL"])
			// FIND matches a substring, so `owner/name` also finds `owner/name-two`. Keep only records whose own key is one of ours.
			if (![unifiedUrlKey(codeUrl), unifiedUrlKey(playableUrl)].some(key => key !== null && keys.includes(key)))
				continue
			const names = record.fields["YSWS–Name"]
			const ysws =
				(Array.isArray(names) ? names.filter(name => typeof name === "string").join(", ") : text(names)) ?? ""
			const recordEmail = text(record.fields["Email - Trimmed & Lowercased"])?.trim().toLowerCase() ?? ""
			matches.push({
				approvedAt: text(record.fields["Approved At"]),
				codeUrl,
				playableUrl,
				sameMaker: email !== "" && recordEmail === email,
				sameProgram: ysws === PROGRAM,
				ysws: ysws || "Unknown",
			})
		}
		return { configured: true, matches }
	} catch (err) {
		return { configured: true, error: (err instanceof Error ? err.message : "The lookup failed").slice(0, 300) }
	}
}
