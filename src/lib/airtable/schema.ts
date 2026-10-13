/**
 * Typed Airtable schema.
 *
 * Two things are true at once, which is why every field carries both an id and a name:
 *
 * - Reads and writes use field IDs, which survive an ops person renaming a column. Siege does this and says why: "robust to column renames". Stasis writes by name, so a rename silently 422s inside a fire-and-forget side effect and nobody notices until payout.
 * - filterByFormula can only reference fields by NAME, so the name has to be here too. `formulaRef()` is the only sanctioned way to build one.
 *
 * The `fld…` ids are filled in once, from `GET https://api.airtable.com/v0/meta/bases/{baseId}/tables`, by running `yarn tsx scripts/dump-airtable-schema.ts` against the created base. Until then the writer falls back to names – see FIELD_MODE below.
 */

export interface FieldDef<T = unknown> {
	readonly id: string
	readonly name: string
	readonly __type?: T
}

const f = <T>(id: string, name: string): FieldDef<T> => ({ id, name })

/**
 * Writing by id requires the ids to actually be filled in. Until someone runs the schema dump against the real base, fall back to names so the integration works out of the box rather than 422-ing on every field.
 */
export const FIELD_MODE: "id" | "name" = process.env.AIRTABLE_USE_FIELD_IDS === "true" ? "id" : "name"

export function fieldKey(field: FieldDef): string {
	return FIELD_MODE === "id" ? field.id : field.name
}

/** filterByFormula cannot use field ids. */
export function formulaRef(field: FieldDef): string {
	return `{${field.name}}`
}

/**
 * The `YSWS Project Submission` table, column for column.
 *
 * The names are NOT ours to choose: they are the base's own, copied verbatim from its field list, and Hack Club's pipeline reads them. A typo here means a field silently goes unfilled (see the drop-and-retry in lib/airtable/ysws).
 *
 * Every row is written by Half Life at submit time, as "Pending Review"; review itself happens on ari.hackclub.com, which moves the row on from there. The `Automation - …` columns belong to the pipeline and are never written here – `Automation - Submit to Unified YSWS` in particular is what sends a row onward, and that is a reviewer's call, not a submitter's.
 */
export const YSWS_SUBMISSION = {
	tableId: process.env.AIRTABLE_YSWS_TABLE_ID ?? "YSWS Project Submission",
	fields: {
		codeUrl: f<string>("fldYswsCodeUrl", "Code URL"),
		firstName: f<string>("fldYswsFirstName", "First Name"),
		lastName: f<string>("fldYswsLastName", "Last Name"),
		email: f<string>("fldYswsEmail", "Email"),
		birthday: f<string>("fldYswsBirthday", "Birthday"),
		slackId: f<string>("fldYswsSlackId", "Slack ID"),
		stage: f<"Design" | "Build">("fldYswsStage", "Design or build"),
		requestedFunding: f<number>("fldYswsRequestedFunding", "Requested funding"),
		hoursSelfReported: f<number>("fldYswsHoursSelfReported", "Hours spent (self reported)"),
		playableUrl: f<string>("fldYswsPlayableUrl", "Playable URL"),
		description: f<string>("fldYswsDescription", "Description"),
		screenshot: f<{ url: string }[]>("fldYswsScreenshot", "Screenshot"),
		journalUrl: f<string>("fldYswsJournalUrl", "Link to JOURNAL.md"),
		lapseLinks: f<string>("fldYswsLapseLinks", "Justification - Lapse Links, comma-separated"),
		githubUsername: f<string>("fldYswsGithubUsername", "GitHub Username"),
		addressLine1: f<string>("fldYswsAddress1", "Address (Line 1)"),
		addressLine2: f<string>("fldYswsAddress2", "Address (Line 2)"),
		city: f<string>("fldYswsCity", "City"),
		zip: f<string>("fldYswsZip", "ZIP / Postal Code"),
		state: f<string>("fldYswsState", "State / Province"),
		country: f<string>("fldYswsCountry", "Country"),
		hackatimeProjects: f<string>(
			"fldYswsHackatimeProjects",
			"Justification - Hackatime Project Name(s) + Date Range(s)",
		),
		hackatimeId: f<string>("fldYswsHackatimeId", "Justification - Submitter Hackatime ID"),
		projectName: f<string>("fldYswsProjectName", "Project name"),
		reviewStatus: f<string>("fldYswsReviewStatus", "Review Status"),
		tier: f<string>("fldYswsTier", "Tier"),
		// Written by the pipeline's automation, read by us: it identifies the row's twin in the unified base, which is the only safe way to remove it.
		unifiedRecordId: f<string>("fldYswsUnifiedRecordId", "Automation - YSWS Record ID"),
	},
} as const

/** What every row says when Half Life writes it; ari.hackclub.com takes it from there. */
export const YSWS_PENDING_REVIEW = "Pending Review"

/**
 * The landing page's sign-up list, in its own base. The RSVP buffer drains into it and the Loops sync reads/writes its Loops columns, so both name it from here – the two modules used to default to different tables ("RSVPs" vs "Signups"), which silently split the funnel from the emails.
 */
export const RSVP_TABLE_ID = process.env.AIRTABLE_RSVP_TABLE_ID ?? "Signups"

export const RSVP = {
	tableId: RSVP_TABLE_ID,
	fields: {
		// Lowercase in the live table. Airtable field names are case-sensitive, and `fields[]=Email` is a 422 that kills the whole list request – which is how the Loops sync never ran (see lib/airtable/loops).
		email: f<string>("fldRsvpEmail", "email"),
		firstName: f<string>("fldRsvpFirstName", "First Name"),
		lastName: f<string>("fldRsvpLastName", "Last Name"),
		pronouns: f<string>("fldRsvpPronouns", "Pronouns"),
		// Lowercase too, and this map said `IP` for as long as it has existed: the probe could never find it, so every row that went through the drain lost its address while the landing's own direct write (lib/site/signups) kept it. The base has the column; only the spelling was wrong.
		ip: f<string>("fldRsvpIp", "ip"),
		// The landing's spellings, because the landing writes them itself: `utm_source` and `referred_by`, not `UTM Source` and `Referred By`. Same failure as `ip` and a worse one – referral attribution is the thing this list exists for, and it was being dropped on every buffered row (see lib/site/referrals, which had to bypass this map to read it).
		utmSource: f<string>("fldRsvpUtmSource", "utm_source"),
		referredBy: f<string>("fldRsvpReferredBy", "referred_by"),
		// `signupPage` used to sit here as `Loops - halfLifeSignUpPage`. Pruned: the base has no such column and never did, and the `Loops - …` family in it is Loops-owned and date-shaped (`halfLifeSignUpAt`, `halfLifeLastLoginAt`, `halfLifeReferralNumber`), so this was a column that was planned and never created rather than one whose spelling had drifted. Left in the map, it cost a probe per deploy to keep learning that.
		finishedAccountCreation: f<boolean>("fldRsvpFinished", "Finished Account Creation"),
		// Stasis joins RSVPs to users on email alone, which breaks when someone RSVPs with a personal address and signs in through HCA with a school one.
		userId: f<string>("fldRsvpUserId", "Half-Life User ID"),
	},
} as const

type FieldMap = Record<string, FieldDef>

type ValuesFor<S extends FieldMap> = Partial<{
	[K in keyof S]: S[K] extends FieldDef<infer T> ? T : never
}>

/** Build an Airtable `fields` payload, keyed however FIELD_MODE says. */
export function toFields<S extends FieldMap>(schema: S, values: ValuesFor<S>): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) continue
		const field = schema[key]
		if (!field) continue
		out[fieldKey(field)] = value
	}
	return out
}
