/**
 * Typed Airtable schema.
 *
 * Two things are true at once, which is why every field carries both an id and a name:
 *
 * - Reads and writes use field IDs, which survive an ops person renaming a column. Siege does this and says why: "robust to column renames". Stasis writes by name, so a rename silently 422s inside a fire-and-forget side effect and nobody notices until payout.
 * - filterByFormula can only reference fields by NAME, so the name has to be here too. `formulaRef()` is the only sanctioned way to build one.
 *
 * The `fld…` ids are filled in once, from `GET https://api.airtable.com/v0/meta/bases/{baseId}/tables`, by running `bun scripts/dump-airtable-schema.ts` against the created base. Until then the writer falls back to names – see FIELD_MODE below.
 */

interface FieldDef<T = unknown> {
	readonly __type?: T
	readonly id: string
	readonly name: string
}

const f = <T>(id: string, name: string): FieldDef<T> => ({ id, name })

/**
 * Writing by id requires the ids to actually be filled in. Until someone runs the schema dump against the real base, fall back to names so the integration works out of the box rather than 422-ing on every field.
 */
const FIELD_MODE: "id" | "name" = process.env.AIRTABLE_USE_FIELD_IDS === "true" ? "id" : "name"

function fieldKey(field: FieldDef): string {
	return FIELD_MODE === "id" ? field.id : field.name
}

/** filterByFormula cannot use field ids. */
function formulaRef(field: FieldDef): string {
	return `{${field.name}}`
}

/**
 * The `YSWS Project Submission` table, column for column.
 *
 * The names are NOT ours to choose: they are the base's own, copied verbatim from its field list, and Hack Club's pipeline reads them. A typo here means a field silently goes unfilled (see the drop-and-retry in lib/airtable/ysws).
 *
 * Every row is written by Half Life at submit time, as "Pending Review"; review itself happens on ari.hackclub.com, which moves the row on from there. The `Automation - …` columns belong to the pipeline and are never written here – `Automation - Submit to Unified YSWS` in particular is what sends a row onward, and that is a reviewer's call, not a submitter's.
 */
const YSWS_SUBMISSION = {
	fields: {
		addressLine1: f<string>("fldYswsAddress1", "Address (Line 1)"),
		addressLine2: f<string>("fldYswsAddress2", "Address (Line 2)"),
		birthday: f<string>("fldYswsBirthday", "Birthday"),
		city: f<string>("fldYswsCity", "City"),
		codeUrl: f<string>("fldYswsCodeUrl", "Code URL"),
		country: f<string>("fldYswsCountry", "Country"),
		description: f<string>("fldYswsDescription", "Description"),
		email: f<string>("fldYswsEmail", "Email"),
		firstName: f<string>("fldYswsFirstName", "First Name"),
		githubUsername: f<string>("fldYswsGithubUsername", "GitHub Username"),
		hackatimeId: f<string>("fldYswsHackatimeId", "Justification - Submitter Hackatime ID"),
		hackatimeProjects: f<string>(
			"fldYswsHackatimeProjects",
			"Justification - Hackatime Project Name(s) + Date Range(s)",
		),
		hoursSelfReported: f<number>("fldYswsHoursSelfReported", "Hours spent (self reported)"),
		journalUrl: f<string>("fldYswsJournalUrl", "Link to JOURNAL.md"),
		lapseLinks: f<string>("fldYswsLapseLinks", "Justification - Lapse Links, comma-separated"),
		lastName: f<string>("fldYswsLastName", "Last Name"),
		// The reviewer whose decision the webhook carries as `review.reviewer.email`. Half Life stores that address on the review (`SubmissionReview.reviewerEmail`), and the same mirror that moves the status fills this column from it. Ari names no one for its second pass – the organizer who confirms a held decision exists only in Ari's internal activity log – so this is the only reviewer column.
		pass1Reviewer: f<string>("fldYswsPass1Reviewer", "Pass 1 reviewer"),
		playableUrl: f<string>("fldYswsPlayableUrl", "Playable URL"),
		projectName: f<string>("fldYswsProjectName", "Project name"),
		// Which program week this submission is for, as the single select Loops triggers off (`Week 1` … `Week 10`). Derived from the theme and phase's own scheduled week (see `projectWeekLabel` in lib/airtable/sync); a warm-up has no scheduled week and leaves it blank.
		projectWeek: f<string>("fldYswsProjectWeek", "Loops - halfLifeProjectWeek"),
		requestedFunding: f<number>("fldYswsRequestedFunding", "Requested funding"),
		// The reviewer's own words on that decision, beside the status and in the same Loops family. Written by the same mirror the status is (see `syncReviewDecisionToYsws` in lib/airtable/sync), because a decision on ari.hackclub.com reaches the base only through it.
		reviewerNotes: f<string>("fldYswsReviewerNotes", "Loops - halfLifeReviewerNotes"),
		reviewStatus: f<string>("fldYswsReviewStatus", "Loops - halfLifeReviewStatus"),
		screenshot: f<{ url: string }[]>("fldYswsScreenshot", "Screenshot"),
		slackId: f<string>("fldYswsSlackId", "Slack ID"),
		// The maker's own account of what they built: the description they wrote, the parts they listed, the work they logged. The pipeline merges it with the other `Justification - …` columns into one blob (see lib/airtable/justification), and an empty column here is an empty blob there.
		specificTechnicalFeatures: f<string>(
			"fldYswsSpecificTechnicalFeatures",
			"Justification - Specific Technical Features",
		),
		stage: f<"Design" | "Build">("fldYswsStage", "Design or build"),
		// A plain checkbox, true when the maker took one of the week's starter projects rather than bringing their own idea (see `starterProjectId` on ThemeProject). Written for the reviewer, who judges a starter by whether it was made the maker's own rather than as a finished build (see STARTER_MODIFICATION_NOTE in lib/config/onboarding); the base needs the fact, not which starter it was.
		starterProject: f<boolean>("fldYswsStarterProject", "Starter project"),
		state: f<string>("fldYswsState", "State / Province"),
		tier: f<string>("fldYswsTier", "Tier"),
		// Written by the pipeline's automation, read by us: it identifies the row's twin in the unified base, which is the only safe way to remove it.
		unifiedRecordId: f<string>("fldYswsUnifiedRecordId", "Automation - YSWS Record ID"),
		zip: f<string>("fldYswsZip", "ZIP / Postal Code"),
	},
	tableId: process.env.AIRTABLE_YSWS_TABLE_ID ?? "YSWS Project Submission",
} as const

/** What a row says while its phase is in review; a decision moves it on (see YSWS_REVIEW_STATUS). */
const YSWS_PENDING_REVIEW = "Pending Review"

/**
 * The rest of what `Loops - halfLifeReviewStatus` can say, one per decision Ari reaches.
 *
 * The column is Loops': it is how a maker hears their work was decided, and a decision on ari.hackclub.com writes nothing to the base on its own – the status is put on the row when the decision arrives (see `syncReviewStatusToYsws` in lib/airtable/sync). A later rewrite of the row derives the status from the phase state rather than resetting it, so the two cannot disagree.
 *
 * Written with `typecast: false`, so each string has to already be an option in the base: a new word here is a 422 the update reports, not an option invented in the base (see the note on typecast in lib/airtable/ysws).
 */
const YSWS_REVIEW_STATUS = {
	approved: "Approved",
	changesRequested: "Changes Requested",
	pending: YSWS_PENDING_REVIEW,
	rejected: "Rejected",
} as const

/**
 * The two columns a review decision writes alongside the status, so the Loops
 * workflow that reads the contact has the project this decision is about.
 *
 * The email-tools poller only forwards a `Loops - …` field when its value
 * changed on that row. The row's normal project name and week were written at
 * submit, so a decision on an older project changes only status and notes – the
 * poller never re-sends the name, and the contact keeps whatever the maker
 * submitted most recently. These `Override` columns are separate fields, so
 * writing them in the decision changes their values and the poller forwards
 * them; email-tools maps the `Loops - Override - ` prefix onto the same Loops
 * property with its `override` strategy.
 *
 * They are plain single-line text fields, because the app does not know their
 * Airtable field ids and writes them by name (see `syncReviewDecisionToYsws`).
 */
const LOOPS_REVIEW_OVERRIDE = {
	projectName: "Loops - Override - halfLifeProjectName",
	projectWeek: "Loops - Override - halfLifeProjectWeek",
} as const

/**
 * The landing page's sign-up list, in its own base. The RSVP buffer drains into it and the Loops sync reads/writes its Loops columns, so both name it from here – the two modules used to default to different tables ("RSVPs" vs "Signups"), which silently split the funnel from the emails.
 */
const RSVP_TABLE_ID = process.env.AIRTABLE_RSVP_TABLE_ID ?? "Signups"

const RSVP = {
	fields: {
		// Lowercase in the live table. Airtable field names are case-sensitive, and `fields[]=Email` is a 422 that kills the whole list request – which is how the Loops sync never ran (see lib/airtable/loops).
		email: f<string>("fldRsvpEmail", "email"),
		// `signupPage` used to sit here as `Loops - halfLifeSignUpPage`. Pruned: the base has no such column and never did, and the `Loops - …` family in it is Loops-owned and date-shaped (`halfLifeSignUpAt`, `halfLifeLastLoginAt`, `halfLifeReferralNumber`), so this was a column that was planned and never created rather than one whose spelling had drifted. Left in the map, it cost a probe per deploy to keep learning that.
		finishedAccountCreation: f<boolean>("fldRsvpFinished", "Finished Account Creation"),
		firstName: f<string>("fldRsvpFirstName", "First Name"),
		// Lowercase too, and this map said `IP` for as long as it has existed: the probe could never find it, so every row that went through the drain lost its address while the landing's own direct write (lib/site/signups) kept it. The base has the column; only the spelling was wrong.
		ip: f<string>("fldRsvpIp", "ip"),
		lastName: f<string>("fldRsvpLastName", "Last Name"),
		pronouns: f<string>("fldRsvpPronouns", "Pronouns"),
		referredBy: f<string>("fldRsvpReferredBy", "referred_by"),
		// Stasis joins RSVPs to users on email alone, which breaks when someone RSVPs with a personal address and signs in through HCA with a school one.
		userId: f<string>("fldRsvpUserId", "Half-Life User ID"),
		// The landing's spellings, because the landing writes them itself: `utm_source` and `referred_by`, not `UTM Source` and `Referred By`. Same failure as `ip` and a worse one – referral attribution is the thing this list exists for, and it was being dropped on every buffered row (see lib/site/referrals, which had to bypass this map to read it).
		utmSource: f<string>("fldRsvpUtmSource", "utm_source"),
	},
	tableId: RSVP_TABLE_ID,
} as const

interface FieldMap {
	[_: string]: FieldDef
}

type ValuesFor<S extends FieldMap> = Partial<{
	[K in keyof S]: S[K] extends FieldDef<infer T> ? T : never
}>

/** Build an Airtable `fields` payload, keyed however FIELD_MODE says. */
function toFields<S extends FieldMap>(schema: S, values: ValuesFor<S>): { [_: string]: unknown } {
	const out: { [_: string]: unknown } = {}
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) continue
		const field = schema[key]
		if (!field) continue
		out[fieldKey(field)] = value
	}
	return out
}

export {
	FIELD_MODE,
	type FieldDef,
	fieldKey,
	formulaRef,
	LOOPS_REVIEW_OVERRIDE,
	RSVP,
	RSVP_TABLE_ID,
	toFields,
	YSWS_PENDING_REVIEW,
	YSWS_REVIEW_STATUS,
	YSWS_SUBMISSION,
}
