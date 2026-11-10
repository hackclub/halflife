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

/**
 * Fill blank address fields on `YSWS Project Submission` rows from the maker's current address.
 *
 * Submission rows are written with the maker's shipping address at hand-in (see `fieldsFor` in lib/airtable/sync), refreshed from HCA at that point. Rows can still end up with blank address columns when PII could not be pulled or decrypted at the time, HCA had no address, or the sync ran without a usable token/key. This backfill refreshes each maker's profile from HCA, decrypts their stored PII, and writes any address field that is still blank on the Airtable row but now has a value.
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

interface CurrentRow {
	addressLine1: string
	addressLine2: string
	city: string
	country: string
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

/** The current address cells for every row in the submission table, read once. */
async function currentRows(
	config: AirtableConfig,
	keys: { [_ in AddressKey]: string },
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
	else if (!isPiiConfigured())
		reasons.push("Encrypted address exists but PII_ENCRYPTION_KEY is not configured for decryption")
	else
		reasons.push(
			"Encrypted address exists but decryption yielded no address (wrong/missing/rotated PII key or malformed payload; check [pii] logs)",
		)

	return reasons.join("; ")
}

async function main() {
	const config = getAirtableConfig()
	if (!config) {
		console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")
		process.exit(1)
	}

	const keys = Object.fromEntries(ADDRESS_FIELDS.map(([key, field]) => [key, fieldKey(field)])) as {
		[_ in AddressKey]: string
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

	// Refresh each maker's address from HCA once, then decrypt their stored PII.
	const userIds = [...new Set(projects.map(project => project.userId))]
	const infoByUser = new Map<string, UserAddressInfo>()
	for (const userId of userIds) {
		try {
			await syncHcaProfile(userId)
		} catch (err) {
			console.warn(`[addresses] could not refresh HCA profile for ${userId}:`, err)
		}
		const user = await db.orm.public.User.whereUnique({ id: userId }).first()
		if (!user) {
			infoByUser.set(userId, {
				address: { addressLine1: "", addressLine2: "", city: "", country: "", state: "", zip: "" },
				reason: "User record not found",
			})
			continue
		}
		const pii = decryptUserPII(user)
		const address = {
			addressLine1: pii.line1?.trim() ?? "",
			addressLine2: pii.line2?.trim() ?? "",
			city: pii.city?.trim() ?? "",
			country: pii.country?.trim() ?? "",
			state: pii.state?.trim() ?? "",
			zip: pii.zip?.trim() ?? "",
		}
		const hasRequired = REQUIRED_KEYS.every(key => address[key])
		infoByUser.set(userId, { address, reason: hasRequired ? null : await diagnoseUser(userId, false) })
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

	for (const [phaseKey, recordId] of records.entries()) {
		const [projectId, phase] = phaseKey.split(":") as [string, Phase]
		const row = current.get(recordId)
		if (!row) {
			gone++
			continue
		}
		const blank = blankAddressFields(row)
		const requiredBlank = blankRequiredFields(row)
		const userId = ownerByProject.get(projectId)
		if (requiredBlank.length === 0) {
			complete++
			// Still fill an available line2 opportunistically, but the row is not missing.
			const line2 = userId && !row.addressLine2 ? (infoByUser.get(userId)?.address.addressLine2 ?? "") : ""
			if (line2) {
				fieldsToFill += 1
				updates.push({
					fields: { [keys.addressLine2]: line2 },
					phase,
					recordId,
					title: titleByProject.get(projectId) ?? projectId,
					userId: userId ?? "",
				})
			}
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
				title: titleByProject.get(projectId) ?? projectId,
				userId: "",
			})
			continue
		}
		const info = infoByUser.get(userId)
		const address = info?.address ?? { addressLine1: "", addressLine2: "", city: "", country: "", state: "", zip: "" }

		const fields: { [_: string]: string } = {}
		const filledByBackfill: AddressKey[] = []
		for (const key of blank) {
			if (!address[key]) continue
			fields[keys[key]] = address[key]
			filledByBackfill.push(key)
		}
		const stillBlank = requiredBlank.filter(key => !address[key])
		const missingValue = stillBlank

		if (filledByBackfill.length > 0) {
			fieldsToFill += filledByBackfill.length
			updates.push({
				fields,
				phase,
				recordId,
				title: titleByProject.get(projectId) ?? projectId,
				userId,
			})
		}

		if (stillBlank.length > 0)
			missing.push({
				blankInAirtable: requiredBlank,
				filledByBackfill: filledByBackfill.filter(key => key !== "addressLine2"),
				missingValue,
				phase,
				projectId,
				reason: info?.reason ?? "Address missing for unknown reason",
				recordId,
				stillBlank,
				title: titleByProject.get(projectId) ?? projectId,
				userId,
			})
	}

	console.log(
		`Projects: ${projects.length}; synced submission rows: ${records.size} (${gone} row(s) since deleted in Airtable, ${complete} already complete)`,
	)
	console.log(
		`Users: ${userIds.length}; rows to update: ${updates.length} (${fieldsToFill} field(s)); rows still with blank address fields after backfill: ${missing.length}`,
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
			users: userIds.length,
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
