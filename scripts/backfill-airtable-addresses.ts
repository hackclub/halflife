import "../src/lib/auth"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
	type AirtableConfig,
	AirtableListSchema,
	airtableFetch,
	getAirtableConfig,
	withRateLimitRetry,
} from "../src/lib/airtable/client"
import { fieldKey, YSWS_SUBMISSION } from "../src/lib/airtable/schema"
import { recordIdsFromSyncEvents } from "../src/lib/airtable/sync"
import { updateYswsRecord } from "../src/lib/airtable/ysws"
import { AuditAction, type Phase } from "../src/lib/enums"
import { PULL_PII, syncHcaProfile } from "../src/lib/hca-profile"
import { decryptUserPII, isPiiConfigured } from "../src/lib/pii"
import db from "../src/lib/prisma8"
import { phaseSchema } from "../src/lib/schemas/common"

/**
 * Fill blank address and name fields on `YSWS Project Submission` rows from the maker's current details.
 *
 * Submission rows are written with the maker's shipping address and name at hand-in (see `fieldsFor` in lib/airtable/sync), refreshed from HCA at that point. Rows can still end up with blank cells when PII could not be pulled or decrypted at the time, HCA had no address or name, or the sync ran without a usable token/key. This backfill looks only at rows that are still missing a required address cell or a name cell, decrypts the owner's stored PII, asks HCA again only when that stored address is incomplete or the owner has no name on file, and writes any field that is still blank on the Airtable row but now has a value.
 *
 * A name is split the way the submit path splits it: the first word is First Name, the rest is Last Name. HCA's name is only written to the account on a sign-in sync, so a refresh for a maker with no name runs that sync, which also refreshes their email and verification status.
 *
 * Only fields that are empty in Airtable are written, so existing values are never overwritten. Rows that still have missing address fields after the run are logged with a reason and written to a JSON report, so the cause can be investigated.
 *
 * Read-only unless `--commit` is passed. Run with `bun --conditions=react-server scripts/backfill-airtable-addresses.ts [--commit]`. In production run it where `DATABASE_URL`, the Airtable secrets, and the HCA/PII env (`PULL_HCA_PII`, `PII_ENCRYPTION_KEY`, HCA credentials) all point at the live environment.
 */

const commit = process.argv.includes("--commit")

const ADDRESS_FIELDS = [
	["addressLine1", YSWS_SUBMISSION.fields.addressLine1],
	["addressLine2", YSWS_SUBMISSION.fields.addressLine2],
	["city", YSWS_SUBMISSION.fields.city],
	["country", YSWS_SUBMISSION.fields.country],
	["state", YSWS_SUBMISSION.fields.state],
	["zip", YSWS_SUBMISSION.fields.zip],
] as const

type AddressKey = (typeof ADDRESS_FIELDS)[number][0]

/** Address Line 2 (apt/suite) is optional; a blank there is normal and not a missing address. */
const REQUIRED_KEYS: AddressKey[] = ADDRESS_FIELDS.map(([key]) => key).filter(key => key !== "addressLine2")

const NAME_FIELDS = [
	["firstName", YSWS_SUBMISSION.fields.firstName],
	["lastName", YSWS_SUBMISSION.fields.lastName],
] as const

type NameKey = (typeof NAME_FIELDS)[number][0]

type FieldKey = AddressKey | NameKey

const EMPTY_ADDRESS: { [_ in AddressKey]: string } = {
	addressLine1: "",
	addressLine2: "",
	city: "",
	country: "",
	state: "",
	zip: "",
}

const EMPTY_NAME: { [_ in NameKey]: string } = { firstName: "", lastName: "" }

interface CurrentRow {
	addressLine1: string
	addressLine2: string
	city: string
	country: string
	firstName: string
	lastName: string
	state: string
	zip: string
}

interface Target {
	fields: { [_: string]: string }
	phase: Phase
	recordId: string
	title: string
	userId: string
}

interface UserAddressInfo {
	address: { [_ in AddressKey]: string }
	name: { [_ in NameKey]: string }
	reason: string | null
}

interface MissingReport {
	blankInAirtable: AddressKey[]
	filledByBackfill: AddressKey[]
	missingValue: AddressKey[]
	phase: Phase
	projectId: string
	reason: string
	recordId: string
	stillBlank: AddressKey[]
	title: string
	userId: string
}

function textCell(value: unknown): string {
	return typeof value === "string" ? value.trim() : ""
}

function blankAddressFields(row: CurrentRow): AddressKey[] {
	return ADDRESS_FIELDS.map(([key]) => key).filter(key => !row[key])
}

function blankRequiredFields(row: CurrentRow): AddressKey[] {
	return REQUIRED_KEYS.filter(key => !row[key])
}

function blankNameFields(row: CurrentRow): NameKey[] {
	return NAME_FIELDS.map(([key]) => key).filter(key => !row[key])
}

/** The address cells held in a user's stored PII. */
function storedAddress(user: Parameters<typeof decryptUserPII>[0]): { [_ in AddressKey]: string } {
	const pii = decryptUserPII(user)
	return {
		addressLine1: pii.line1?.trim() ?? "",
		addressLine2: pii.line2?.trim() ?? "",
		city: pii.city?.trim() ?? "",
		country: pii.country?.trim() ?? "",
		state: pii.state?.trim() ?? "",
		zip: pii.zip?.trim() ?? "",
	}
}

/** A name split the way the submit path splits it (lib/airtable/sync): the first word, then the rest. */
function nameParts(name: string | null | undefined): { [_ in NameKey]: string } {
	const [firstName = "", ...rest] = (name ?? "").trim().split(/\s+/)
	return { firstName, lastName: rest.join(" ") }
}

/** The current address and name cells for every row in the submission table, read once. */
async function currentRows(
	config: AirtableConfig,
	keys: { [_ in FieldKey]: string },
): Promise<Map<string, CurrentRow>> {
	const qs = Object.values(keys)
		.map(key => `fields%5B%5D=${encodeURIComponent(key)}`)
		.join("&")
	const byId = new Map<string, CurrentRow>()
	let offset: string | undefined
	do {
		const page = await withRateLimitRetry("listYswsAddresses", () =>
			airtableFetch(
				AirtableListSchema,
				config,
				`${encodeURIComponent(YSWS_SUBMISSION.tableId)}?pageSize=100&${qs}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		for (const record of page.records)
			byId.set(record.id, {
				addressLine1: textCell(record.fields[keys.addressLine1]),
				addressLine2: textCell(record.fields[keys.addressLine2]),
				city: textCell(record.fields[keys.city]),
				country: textCell(record.fields[keys.country]),
				firstName: textCell(record.fields[keys.firstName]),
				lastName: textCell(record.fields[keys.lastName]),
				state: textCell(record.fields[keys.state]),
				zip: textCell(record.fields[keys.zip]),
			})
		;({ offset } = page)
	} while (offset)
	return byId
}

function envReasonHints(): string[] {
	const hints: string[] = []
	if (process.env.PULL_HCA_PII !== "true") hints.push("PULL_HCA_PII is not true")
	if (!isPiiConfigured()) hints.push("PII_ENCRYPTION_KEY is not configured")
	return hints
}

async function diagnoseUser(userId: string, hasAnyAddress: boolean): Promise<string> {
	if (hasAnyAddress) return "Partial address on file: some fields are missing from the stored/HCA address."

	const hints = envReasonHints()
	const user = await db.orm.public.User.whereUnique({ id: userId })
		.select(
			"encryptedAddressCity",
			"encryptedAddressCountry",
			"encryptedAddressLine2",
			"encryptedAddressState",
			"encryptedAddressStreet",
			"encryptedAddressZip",
		)
		.first()
	const hcaAccounts = await db.orm.public.Account.where({ providerId: "hca", userId }).select("id").all()

	const reasons: string[] = []
	if (hcaAccounts.length === 0) reasons.push("No linked HCA account")
	if (!PULL_PII) reasons.push(`PII pull disabled (${hints.join(", ") || "PULL_HCA_PII/PII key not configured"})`)

	const hasEncrypted = Boolean(
		user
			&& (user.encryptedAddressStreet
				|| user.encryptedAddressLine2
				|| user.encryptedAddressCity
				|| user.encryptedAddressState
				|| user.encryptedAddressZip
				|| user.encryptedAddressCountry),
	)
	if (!hasEncrypted)
		reasons.push(
			"No encrypted address stored in DB after HCA refresh (HCA returned no address, token/sync unavailable, or PII not pulled)",
		)
	else if (isPiiConfigured())
		reasons.push(
			"Encrypted address exists but decryption yielded no address (wrong/missing/rotated PII key or malformed payload; check [pii] logs)",
		)
	else reasons.push("Encrypted address exists but PII_ENCRYPTION_KEY is not configured for decryption")

	return reasons.join("; ")
}

async function main() {
	const config = getAirtableConfig()
	if (!config) {
		console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")
		process.exit(1)
	}

	const keys: { [_ in FieldKey]: string } = {
		addressLine1: fieldKey(YSWS_SUBMISSION.fields.addressLine1),
		addressLine2: fieldKey(YSWS_SUBMISSION.fields.addressLine2),
		city: fieldKey(YSWS_SUBMISSION.fields.city),
		country: fieldKey(YSWS_SUBMISSION.fields.country),
		firstName: fieldKey(YSWS_SUBMISSION.fields.firstName),
		lastName: fieldKey(YSWS_SUBMISSION.fields.lastName),
		state: fieldKey(YSWS_SUBMISSION.fields.state),
		zip: fieldKey(YSWS_SUBMISSION.fields.zip),
	}

	const projects = await db.orm.public.ThemeProject.where({ deletedAt: null }).select("id", "title", "userId").all()
	if (projects.length === 0) {
		console.log("No projects; nothing to backfill.")
		return
	}

	const events = await db.orm.public.AuditLog.where({ action: AuditAction.AIRTABLE_SYNC_SUCCESS })
		.where(entry => entry.targetId.in(projects.map(p => p.id)))
		.orderBy(entry => entry.createdAt.desc())
		.select("metadata", "targetId")
		.all()
	const records = recordIdsFromSyncEvents(events)

	const current = await currentRows(config, keys)

	const ownerByProject = new Map(projects.map(project => [project.id, project.userId]))
	const titleByProject = new Map(projects.map(project => [project.id, project.title]))

	// Only owners of a row that is actually missing a required address cell or a name cell need a refresh: a complete row cannot be filled from one, and most owners have no blank row at all. Without this a scheduled run asks HCA about every owner on the books before writing anything.
	const userIds = new Set<string>()
	for (const [phaseKey, recordId] of records) {
		const row = current.get(recordId)
		if (!row || (blankRequiredFields(row).length === 0 && blankNameFields(row).length === 0)) continue
		const separator = phaseKey.indexOf(":")
		if (separator === -1) continue
		const userId = ownerByProject.get(phaseKey.slice(0, separator))
		if (userId) userIds.add(userId)
	}

	// Decrypt what is stored first. A maker whose stored address is already complete needs no HCA round trip for the address: this backfill only fills blank Airtable cells, so a refresh could not change what gets written. A maker with no name on file is asked once, with a sign-in sync, because HCA's name is only written to the account there. Asking HCA for every owner instead spends thousands of requests against its rate limit for nothing.
	const infoByUser = new Map<string, UserAddressInfo>()
	for (const userId of userIds) {
		let user = await db.orm.public.User.whereUnique({ id: userId }).first()
		if (!user) {
			infoByUser.set(userId, { address: EMPTY_ADDRESS, name: EMPTY_NAME, reason: "User record not found" })
			continue
		}
		let address = storedAddress(user)
		const needsName = !nameParts(user.name).firstName
		if (needsName || !REQUIRED_KEYS.every(key => address[key])) {
			try {
				await syncHcaProfile(userId, { profile: needsName })
			} catch (err) {
				console.warn(`[addresses] could not refresh HCA profile for ${userId}:`, err)
			}
			user = await db.orm.public.User.whereUnique({ id: userId }).first()
			if (!user) {
				infoByUser.set(userId, {
					address: EMPTY_ADDRESS,
					name: EMPTY_NAME,
					reason: "User record not found after HCA refresh",
				})
				continue
			}
			address = storedAddress(user)
		}
		const hasRequired = REQUIRED_KEYS.every(key => address[key])
		infoByUser.set(userId, {
			address,
			name: nameParts(user.name),
			reason: hasRequired ? null : await diagnoseUser(userId, false),
		})
	}
	// Diagnose partial addresses too (missing required fields only; line2 alone is not partial).
	for (const info of infoByUser.values()) {
		const hasRequired = REQUIRED_KEYS.every(key => info.address[key])
		if (!hasRequired && !info.reason)
			info.reason = "Partial address on file: some fields are missing from the stored/HCA address."
	}

	const updates: Target[] = []
	const missing: MissingReport[] = []
	let gone = 0
	let complete = 0
	let fieldsToFill = 0
	let nameGaps = 0

	function queueFill(recordId: string, phase: Phase, title: string, userId: string, fields: { [_: string]: string }) {
		const count = Object.keys(fields).length
		if (count === 0) return
		fieldsToFill += count
		updates.push({ fields, phase, recordId, title, userId })
	}

	for (const [phaseKey, recordId] of records.entries()) {
		// The key is `${submissionId}:${phase}`, but the phase half arrives via audit metadata and was never validated there – skip a row whose phase is not a real one rather than filing it under a phase that does not exist.
		const separator = phaseKey.indexOf(":")
		if (separator === -1) continue
		const parsedPhase = phaseSchema.safeParse(phaseKey.slice(separator + 1))
		if (!parsedPhase.success) continue
		const projectId = phaseKey.slice(0, separator)
		const phase = parsedPhase.data
		const row = current.get(recordId)
		if (!row) {
			gone++
			continue
		}
		const blank = blankAddressFields(row)
		const requiredBlank = blankRequiredFields(row)
		const userId = ownerByProject.get(projectId)
		const title = titleByProject.get(projectId) ?? projectId
		const info = userId ? infoByUser.get(userId) : undefined
		const address = info?.address ?? EMPTY_ADDRESS

		// A name fills whichever row it is blank on, whatever the address is doing. Only a name the owner actually has is written.
		const fields: { [_: string]: string } = {}
		for (const key of blankNameFields(row)) {
			const value = info?.name[key] ?? ""
			if (!value) {
				nameGaps++
				continue
			}
			fields[keys[key]] = value
		}

		if (requiredBlank.length === 0) {
			complete++
			// Still fill an available line2 opportunistically, but the row is not missing.
			if (!row.addressLine2 && address.addressLine2) fields[keys.addressLine2] = address.addressLine2
			queueFill(recordId, phase, title, userId ?? "", fields)
			continue
		}
		if (!userId) {
			missing.push({
				blankInAirtable: blank,
				filledByBackfill: [],
				missingValue: blank,
				phase,
				projectId,
				reason: "Project owner not found",
				recordId,
				stillBlank: blank,
				title,
				userId: "",
			})
			continue
		}

		const filledByBackfill: AddressKey[] = []
		for (const key of blank) {
			if (!address[key]) continue
			fields[keys[key]] = address[key]
			filledByBackfill.push(key)
		}
		queueFill(recordId, phase, title, userId, fields)

		const stillBlank = requiredBlank.filter(key => !address[key])
		if (stillBlank.length > 0)
			missing.push({
				blankInAirtable: requiredBlank,
				filledByBackfill: filledByBackfill.filter(key => key !== "addressLine2"),
				missingValue: stillBlank,
				phase,
				projectId,
				reason: info?.reason ?? "Address missing for unknown reason",
				recordId,
				stillBlank,
				title,
				userId,
			})
	}

	console.log(
		`Projects: ${projects.length}; synced submission rows: ${records.size} (${gone} row(s) since deleted in Airtable, ${complete} already complete)`,
	)
	console.log(
		`Owners with a blank row or name: ${userIds.size}; rows to update: ${updates.length} (${fieldsToFill} field(s)); rows still with blank address fields after backfill: ${missing.length}; cells still blank for a name the owner has no value for: ${nameGaps}`,
	)
	for (const target of updates.slice(0, 10))
		console.log(`  fill  ${target.phase}  ${target.title}  →  ${Object.keys(target.fields).join(", ")}`)
	if (updates.length > 10) console.log(`  …and ${updates.length - 10} more`)

	for (const row of missing.slice(0, 20))
		console.log(
			`  missing  ${row.phase}  ${row.title} (${row.recordId})  still blank: [${row.stillBlank.join(", ")}]  filled: [${row.filledByBackfill.join(", ")}]  reason: ${row.reason}`,
		)
	if (missing.length > 20) console.log(`  …and ${missing.length - 20} more missing rows`)

	// Always write a report so missing-address reasons are recorded ("marked") for follow-up.
	const report = {
		commit,
		generatedAt: new Date().toISOString(),
		missing,
		summary: {
			complete,
			fieldsToFill,
			gone,
			missingRows: missing.length,
			projects: projects.length,
			rows: records.size,
			toUpdate: updates.length,
			users: userIds.size,
		},
	}
	const outDir = "/tmp/opencode"
	mkdirSync(outDir, { recursive: true })
	const outPath = join(outDir, `backfill-airtable-addresses-${Date.now()}.json`)
	writeFileSync(outPath, JSON.stringify(report, null, 2))
	console.log(`Missing-address report written to ${outPath}`)

	if (!commit) {
		console.log("Dry run. Pass --commit to write the address fields on these rows.")
		return
	}

	let updated = 0
	let rowGone = 0
	let failed = 0
	for (const target of updates) {
		const written = await updateYswsRecord(target.recordId, target.fields)
		if (written.ok) updated++
		else if (written.reason === "row_gone") rowGone++
		else {
			failed++
			console.error(`  ${target.phase}  ${target.title} (${target.recordId}) failed: ${written.reason}`)
		}
	}
	console.log(`updated: ${updated}, row gone: ${rowGone}, failed: ${failed}`)
	if (missing.length > 0)
		console.log(
			`Rows still missing address fields after run: ${missing.length}. See report ${outPath} for per-row reasons.`,
		)
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exitCode = 1
} finally {
	await db.close()
}

// `lib/auth` leaves a handle open (the OAuth client), so the work finishes and the process then never exits. The database is closed; end the script explicitly so a scheduled job step does not sit there until its timeout.
process.exit(process.exitCode ?? 0)
