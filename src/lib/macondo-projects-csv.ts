import { HoursSource, Phase, PhaseStatus, Theme } from "@/app/generated/prisma/enums"
import { rehostScreenshot } from "@/lib/airtable/warmup-import"
import { AuditAction, logAuditTx } from "@/lib/audit"
import { HttpError } from "@/lib/errors"
import prisma from "@/lib/prisma"
import { effectiveDateFor, getProgramSettings } from "@/lib/program"

/**
 * Projects submitted through Macondo (macondo.hackclub.com), taken out as a CSV and brought in as warm-up projects.
 *
 * Matches a7ipcp1.csv's columns exactly, but is tolerant of new/renamed columns: an unknown column is ignored, a required one missing fails the whole file, and every row needs an email and a title. Each row becomes one ThemeProject with Theme.WARMUP, and each entry in its `journals` column becomes a WorkSession carrying its hours – the same shape the Airtable warm-up import produces, so nothing downstream has to special-case them.
 */

const MAX_ROWS = 500

/** RFC 4180 records, shared shape with ./shop-csv. */
function records(text: string): { line: number; fields: string[] }[] {
	const out: { line: number; fields: string[] }[] = []
	let fields: string[] = []
	let field = ""
	let quoted = false
	let line = 1
	let start = 1
	const src = text.replace(/^\uFEFF/, "")

	for (let i = 0; i < src.length; i += 1) {
		const c = src[i]
		if (quoted) {
			if (c === '"' && src[i + 1] === '"') {
				field += '"'
				i += 1
			} else if (c === '"') {
				quoted = false
			} else if (c === "\r" && src[i + 1] === "\n") {
			} else {
				if (c === "\n") line += 1
				field += c
			}
			continue
		}
		if (c === '"') quoted = true
		else if (c === ",") {
			fields.push(field)
			field = ""
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && src[i + 1] === "\n") i += 1
			fields.push(field)
			out.push({ line: start, fields })
			fields = []
			field = ""
			line += 1
			start = line
		} else field += c
	}
	if (field !== "" || fields.length > 0) {
		fields.push(field)
		out.push({ line: start, fields })
	}
	return out.filter((r) => r.fields.some((f) => f.trim() !== ""))
}

const COLUMNS = [
	"project_id",
	"project_title",
	"project_description",
	"journals",
	"journal_count",
	"journal_hours_total",
	"demo_url",
	"repository_url",
	"thumbnail_url",
	"author_email",
	"collaborator_emails",
	"collaborator_hackatime_projects",
	"tier",
	"author_hackatime_projects",
	"created_at",
	"submitted_at",
	"transferred_at",
	"macondo_url",
] as const
type Column = (typeof COLUMNS)[number]

/** Spreadsheet headings people actually type, folded onto the columns. */
const HEADER_ALIASES: Record<string, Column> = {
	projectid: "project_id",
	id: "project_id",
	projecttitle: "project_title",
	title: "project_title",
	name: "project_title",
	projectdescription: "project_description",
	description: "project_description",
	journals: "journals",
	journalcount: "journal_count",
	count: "journal_count",
	journalhourstotal: "journal_hours_total",
	hours: "journal_hours_total",
	demourl: "demo_url",
	demo: "demo_url",
	repositoryurl: "repository_url",
	repo: "repository_url",
	repourl: "repository_url",
	thumbnailurl: "thumbnail_url",
	thumbnail: "thumbnail_url",
	authorsemail: "author_email",
	authoremail: "author_email",
	author: "author_email",
	email: "author_email",
	collaboratoremails: "collaborator_emails",
	collaborators: "collaborator_emails",
	collaboratorhackatimeprojects: "collaborator_hackatime_projects",
	tier: "tier",
	authorhackatimeprojects: "author_hackatime_projects",
	createdat: "created_at",
	created: "created_at",
	submittedat: "submitted_at",
	submitted: "submitted_at",
	transferredat: "transferred_at",
	macondourl: "macondo_url",
	macondo: "macondo_url",
}

export interface MacondoJournal {
	title: string | null
	content: string | null
	createdAt: Date | null
	hours: number
}

export interface MacondoRow {
	projectId: string
	title: string
	description: string | null
	email: string
	hoursTotal: number | null
	demoUrl: string | null
	repoUrl: string | null
	thumbnailUrl: string | null
	tier: number | null
	createdAt: Date | null
	submittedAt: Date | null
	macondoUrl: string | null
	journals: MacondoJournal[]
}

export interface CsvProblem {
	line: number
	message: string
}

/**
 * The Macondo CSV is JSON-in-a-cell for the journals column, which may be malformed or missing entirely – it degrades to an empty journal list rather than refusing the row, because the project's title, email and repo are still worth having.
 */
function parseJournals(raw: string): MacondoJournal[] {
	const trimmed = raw.trim()
	if (!trimmed) return []
	let data: unknown
	try {
		data = JSON.parse(trimmed)
	} catch {
		return []
	}
	if (!Array.isArray(data)) return []
	const out: MacondoJournal[] = []
	for (const entry of data) {
		if (!entry || typeof entry !== "object") continue
		const e = entry as Record<string, unknown>
		const hours = Number(e.hours)
		out.push({
			title: typeof e.title === "string" ? e.title : null,
			content: typeof e.content === "string" ? e.content : null,
			createdAt:
				typeof e.created_at === "string" && !Number.isNaN(Date.parse(e.created_at)) ? new Date(e.created_at) : null,
			hours: Number.isFinite(hours) && hours > 0 ? hours : 0,
		})
	}
	return out
}

function date(raw: string): Date | null {
	const v = raw.trim()
	if (!v) return null
	const t = Date.parse(v)
	return Number.isFinite(t) ? new Date(t) : null
}

export function parseProjectsCsv(text: string): { rows: MacondoRow[]; problems: CsvProblem[] } {
	const lines = records(text)
	const head = lines.shift()
	if (!head) return { rows: [], problems: [{ line: 0, message: "The file is empty." }] }

	const columns = head.fields.map(
		(h) =>
			HEADER_ALIASES[
				h
					.trim()
					.toLowerCase()
					.replace(/[^a-z]/g, "")
			],
	)
	const problems: CsvProblem[] = []
	const missing: Column[] = []
	for (const required of ["project_id", "project_title", "author_email"] as Column[]) {
		if (!columns.includes(required)) missing.push(required)
	}
	if (missing.length > 0)
		problems.push({ line: 1, message: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` })
	if (problems.length > 0) return { rows: [], problems }

	if (lines.length === 0)
		return { rows: [], problems: [{ line: 0, message: "The file has a header but no projects." }] }
	if (lines.length > MAX_ROWS)
		return {
			rows: [],
			problems: [{ line: 0, message: `At most ${MAX_ROWS} projects per import; this file has ${lines.length}.` }],
		}

	const rows: MacondoRow[] = []
	for (const row of lines) {
		const cell = (c: Column) => {
			const i = columns.indexOf(c)
			return i < 0 ? "" : (row.fields[i] ?? "").trim()
		}
		const say = (message: string) => problems.push({ line: row.line, message })

		const email = cell("author_email").toLowerCase()
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			say("author_email is missing or not an email address")
			continue
		}
		const title = cell("project_title")
		if (!title) {
			say("project_title is required")
			continue
		}
		const projectId = cell("project_id")
		if (!projectId) {
			say("project_id is required")
			continue
		}

		const rawTier = cell("tier")
		let tier = rawTier ? Number(rawTier) : null
		if (tier !== null && (!Number.isFinite(tier) || tier < 1 || tier > 3)) {
			// Macondo tiers sometimes go past 3; clamp rather than fail so the import works.
			tier = tier === null ? null : Math.min(3, Math.max(1, Math.round(tier)))
		}

		const hoursTotalRaw = cell("journal_hours_total")
		const hoursTotal = hoursTotalRaw ? Number(hoursTotalRaw) : null
		rows.push({
			projectId,
			title,
			description: cell("project_description") || null,
			email,
			hoursTotal: hoursTotal !== null && Number.isFinite(hoursTotal) ? hoursTotal : null,
			demoUrl: cell("demo_url") || null,
			repoUrl: cell("repository_url") || null,
			thumbnailUrl: cell("thumbnail_url") || null,
			tier,
			createdAt: date(cell("created_at")),
			submittedAt: date(cell("submitted_at")),
			macondoUrl: cell("macondo_url") || null,
			journals: parseJournals(cell("journals")),
		})
	}

	return problems.length > 0 ? { rows: [], problems } : { rows, problems }
}

export interface CsvImportOutcome {
	projectId: string
	email: string
	title: string
	status: "imported" | "already_imported" | "failed"
	reason: string | null
}

/**
 * Which projects a previous run already filed. Keyed on the CSV's project_id rather than a local id, so re-running a file neither duplicates nor touches a project.
 */
async function importedProjectIds(): Promise<Set<string>> {
	const rows = await prisma.auditLog.findMany({
		where: { action: AuditAction.ADMIN_IMPORT_AIRTABLE_PROJECT },
		select: { metadata: true },
	})
	const out = new Set<string>()
	for (const row of rows) {
		const meta = row.metadata as { macondoProjectId?: unknown } | null
		if (typeof meta?.macondoProjectId === "string") out.add(meta.macondoProjectId)
	}
	return out
}

export interface CsvImportSummary {
	read: number
	imported: number
	alreadyImported: number
	failed: number
	outcomes: CsvImportOutcome[]
}

interface ImportActor {
	id: string
	email: string | null
}

export async function importMacondoProjects(actor: ImportActor, csv: string): Promise<CsvImportSummary> {
	const parsed = parseProjectsCsv(csv)
	if (parsed.problems.length > 0) {
		throw new HttpError("VALIDATION_FAILED", "Nothing was imported. Fix these and try again.", {
			problems: parsed.problems,
		})
	}

	const done = await importedProjectIds()
	const settings = await getProgramSettings()

	let imported = 0
	let alreadyImported = 0
	let failed = 0
	const outcomes: CsvImportOutcome[] = []

	for (const row of parsed.rows) {
		if (done.has(row.projectId)) {
			alreadyImported += 1
			outcomes.push({
				projectId: row.projectId,
				email: row.email,
				title: row.title,
				status: "already_imported",
				reason: null,
			})
			continue
		}

		try {
			const createdAt = row.createdAt ?? new Date()

			const user =
				(await prisma.user.findFirst({
					where: { email: { equals: row.email, mode: "insensitive" } },
					select: { id: true },
				})) ??
				(await prisma.user.create({
					data: {
						email: row.email,
						emailVerified: false,
						joinedProgramAt: createdAt,
					},
					select: { id: true },
				}))

			const project = await prisma.themeProject.create({
				data: {
					userId: user.id,
					theme: Theme.WARMUP,
					title: row.title,
					description: row.description,
					githubRepo: row.repoUrl,
					requestedTier: row.tier ?? 1,
					warmupPhase: Phase.BUILD,
					namedAt: createdAt,
					createdAt,
					buildStatus: PhaseStatus.in_review,
					artifactLinks:
						row.demoUrl || row.macondoUrl
							? [
									...(row.demoUrl ? [{ label: "Demo", url: row.demoUrl }] : []),
									...(row.macondoUrl ? [{ label: "Macondo", url: row.macondoUrl }] : []),
								]
							: undefined,
				},
				select: { id: true },
			})

			for (const journal of row.journals) {
				await prisma.workSession.create({
					data: {
						themeProjectId: project.id,
						phase: Phase.BUILD,
						title: journal.title ?? "Devlog",
						content: journal.content,
						hoursClaimed: journal.hours,
						hoursSource: HoursSource.MANUAL,
						weekNumber: 0,
						effectiveDate: effectiveDateFor(journal.createdAt ?? createdAt, settings.programTimezone),
						createdAt: journal.createdAt ?? createdAt,
					},
				})
			}

			await prisma.phaseSubmission.create({
				data: {
					themeProjectId: project.id,
					phase: Phase.BUILD,
					submittedInWeek: 0,
					scheduledWeek: 0,
					onTime: false,
					createdAt: row.submittedAt ?? createdAt,
				},
			})

			let coverImported = false
			if (row.thumbnailUrl) {
				const key = await rehostScreenshot(user.id, row.thumbnailUrl)
				if (key) {
					await prisma.themeProject.update({ where: { id: project.id }, data: { coverImageKey: key } })
					coverImported = true
				}
			}

			await prisma.$transaction(async (tx) => {
				await logAuditTx(tx, {
					action: AuditAction.ADMIN_IMPORT_AIRTABLE_PROJECT,
					actorId: actor.id,
					actorEmail: actor.email,
					targetType: "ThemeProject",
					targetId: project.id,
					metadata: {
						source: "macondo-csv",
						macondoProjectId: row.projectId,
						email: row.email,
						title: row.title,
						devlogCount: row.journals.length,
						coverImported,
					},
				})
			})

			imported += 1
			done.add(row.projectId)
			outcomes.push({ projectId: row.projectId, email: row.email, title: row.title, status: "imported", reason: null })
		} catch (err) {
			failed += 1
			outcomes.push({
				projectId: row.projectId,
				email: row.email,
				title: row.title,
				status: "failed",
				reason: err instanceof Error ? err.message : String(err),
			})
		}
	}

	return { read: parsed.rows.length, imported, alreadyImported, failed, outcomes }
}
