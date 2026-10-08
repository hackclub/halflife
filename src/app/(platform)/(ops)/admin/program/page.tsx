import { headers } from "next/headers"
import Link from "next/link"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { AirtableImportForm } from "@/app/components/forms/AirtableImportForm"
import { CsvProjectsImport } from "@/app/components/forms/CsvProjectsImport"
import { ProgramSettingsForm } from "@/app/components/forms/ProgramSettingsForm"
import { ProgramStartForm } from "@/app/components/forms/ProgramStartForm"
import { Badge, EmptyState, PageHeader, Panel, Table } from "@/app/components/ui"
import { Phase } from "@/app/generated/prisma/enums"
import { getAirtableConfig } from "@/lib/airtable/client"
import { YSWS_SUBMISSION } from "@/lib/airtable/schema"
import { findUnsyncedSubmissions } from "@/lib/airtable/sync"
import { ariWebhookUrl, findUnsyncedAriSubmissions, isAriConfigured, isAriWebhookConfigured } from "@/lib/ari"
import { PRINTERS, submitFloorFor } from "@/lib/config/printers"
import { scheduleForWeek, TOTAL_WEEKS } from "@/lib/config/program"
import { TIERS } from "@/lib/config/tiers"
import { formatDeadline } from "@/lib/deadline"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { currentWeekNumber, getProgramSettings, weekClosesAt, weekDateRange, weekOpensAt } from "@/lib/program"
import { getOpenDisputes } from "@/lib/queries/review"

export const dynamic = "force-dynamic"

export default async function AdminProgramPage() {
	await requirePermissionPage(Permission.MANAGE_PROGRAM)

	const [settings, week, unsynced, unsyncedAri, disputes, h] = await Promise.all([
		getProgramSettings(),
		currentWeekNumber(),
		findUnsyncedSubmissions(),
		findUnsyncedAriSubmissions(),
		getOpenDisputes(),
		headers(),
	])

	// The callback URL to register with Ari, resolved the same way the phone handoff resolves its origin: the configured public origin wins, the request's own host is only a local-development fallback.
	const host = h.get("x-forwarded-host") ?? h.get("host")
	const proto = h.get("x-forwarded-proto") ?? "https"
	const callbackUrl = ariWebhookUrl(host ? `${proto}://${host}` : "")
	const ariSending = isAriConfigured()
	const ariReceiving = isAriWebhookConfigured()
	const airtableReady = getAirtableConfig() !== null

	const startYmd = settings.eventStartDate.toISOString().slice(0, 10)
	const now = new Date()
	const schedule = Array.from({ length: TOTAL_WEEKS }, (_, i) => {
		const n = i + 1
		const slot = scheduleForWeek(n)
		const range = weekDateRange(settings.eventStartDate, n)
		const closesAt = weekClosesAt(settings, n)
		const opensAt = weekOpensAt(settings, n)
		const day = { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" } as const
		return {
			week: n,
			label: slot ? `${slot.theme.label} · ${slot.phase === Phase.DESIGN ? "design" : "build"}` : "—",
			runs: range
				? `${range.start.toLocaleDateString("en-US", day)} – ${new Date(range.start.getTime() + 6 * 86_400_000).toLocaleDateString("en-US", day)}`
				: "—",
			closes: formatDeadline(closesAt, settings.programTimezone, "short"),
			state: now >= closesAt ? "passed" : now >= opensAt ? "current" : "upcoming",
		}
	})

	return (
		<div className="hl-stack">
			<PageHeader
				title="Program settings"
				subtitle={
					week < 1
						? "The program has not started yet."
						: week > TOTAL_WEEKS
							? "The program is over."
							: `Currently week ${week} of ${TOTAL_WEEKS}.`
				}
			/>

			<Panel title="Program start">
				<ProgramStartForm initial={startYmd} timezone={settings.programTimezone} weeks={schedule.map((w) => w.label)} />
			</Panel>

			<Panel title="Schedule">
				<Table head={["Week", "Theme", "Runs", "Closes", ""]}>
					{schedule.map((w) => (
						<tr key={w.week}>
							<td className="hl-mono">{w.week}</td>
							<td>{w.label}</td>
							<td>{w.runs}</td>
							<td className="hl-mono">{w.closes}</td>
							<td>
								<Badge tone={w.state === "passed" ? "muted" : w.state === "current" ? "success" : "warning"}>
									{w.state}
								</Badge>
							</td>
						</tr>
					))}
				</Table>
				<p className="hl-hint">
					A passed week is shut on the map: no more journal entries, only its Submit. An extension on the user or the
					project reopens it for them.
				</p>
			</Panel>

			<Panel title="Settings">
				{/* These live in the database rather than env vars on purpose: stasis
            put its submission gate in an env var, nobody flipped it, and
            submissions stayed open for two weeks after the event ended. */}
				<ProgramSettingsForm
					initial={{
						programTimezone: settings.programTimezone,
						submissionsOpen: settings.submissionsOpen,
						submissionsCloseAt: settings.submissionsCloseAt?.toISOString().slice(0, 16) ?? null,
						shopOpen: settings.shopOpen,
						shopClosesAt: settings.shopClosesAt?.toISOString().slice(0, 16) ?? null,
						shopGraceDays: settings.shopGraceDays,
						reviewClaimTtlMinutes: settings.reviewClaimTtlMinutes,
						airtableSyncEnabled: settings.airtableSyncEnabled,
						repoSyncEnabled: settings.repoSyncEnabled,
					}}
				/>
			</Panel>

			<Panel title="Warm-up projects from Airtable">
				<p className="hl-hint">
					Before the platform opened, projects were submitted through the warm-up submission form, which writes rows
					into the <code>{YSWS_SUBMISSION.tableId}</code> table (<code>AIRTABLE_YSWS_TABLE_ID</code>). Importing files
					each one on the maker&apos;s Warm Up track – a pre-season slot that does not use one of their five season
					themes – creates their account if they have not signed up yet, records the self-reported hours as a work
					session, and hands the project to Ari for review. Rows already imported, and rows Half Life itself wrote, are
					skipped, so the button is safe to run again. Every row becomes its own project: a maker who handed the form in
					more than once gets every project they submitted.
				</p>
				{airtableReady ? (
					<AirtableImportForm ariConfigured={ariSending} />
				) : (
					<EmptyState>Airtable is not configured on this deployment, so there is nothing to import.</EmptyState>
				)}
			</Panel>

			<Panel title="Warm-up projects from CSV">
				<p className="hl-hint">
					Import a CSV exported from Macondo (project_id, project_title, project_description, journals, tier, author_email, repository_url, thumbnail_url, and the rest). Each row becomes its own warm-up project on the same Warm Up track – a pre-season slot that does not use one of the five season themes – with an account created if the row&apos;s email has none, and one work session filed per entry in the row&apos;s journals column. Rows already imported are reported instead of duplicated, so the button is safe to run again.
				</p>
				<CsvProjectsImport />
			</Panel>

			<Panel title="Submissions that never reached Airtable">
				{unsynced.length === 0 ? (
					<EmptyState>Every submission awaiting review is in the YSWS table.</EmptyState>
				) : (
					<Table head={["Project", "Phase", ""]}>
						{unsynced.map((item) => (
							<tr key={`${item.themeProjectId}-${item.phase}`}>
								<td className="hl-mono">{item.themeProjectId}</td>
								<td>{item.phase.toLowerCase()}</td>
								<td>
									<ActionButton
										url={`/api/admin/theme-projects/${item.themeProjectId}/sync-to-airtable`}
										body={{ phase: item.phase }}
										label="Retry"
									/>
								</td>
							</tr>
						))}
					</Table>
				)}
			</Panel>

			<Panel title="Submissions that never reached Ari">
				{!ariSending ? (
					<EmptyState>Ari is not configured on this deployment, so nothing is sent there.</EmptyState>
				) : unsyncedAri.length === 0 ? (
					<EmptyState>Every submission awaiting review is in Ari.</EmptyState>
				) : (
					<Table head={["Project", "Phase", ""]}>
						{unsyncedAri.map((item) => (
							<tr key={`${item.themeProjectId}-${item.phase}`}>
								<td className="hl-mono">{item.themeProjectId}</td>
								<td>{item.phase.toLowerCase()}</td>
								<td>
									<ActionButton
										url={`/api/admin/theme-projects/${item.themeProjectId}/sync-to-ari`}
										body={{ phase: item.phase }}
										label="Retry"
									/>
								</td>
							</tr>
						))}
					</Table>
				)}
				<p className="hl-hint">
					A ship is what the reviewer sees, so a submission missing from Ari is a submission nobody will decide. The
					hourly retry job replays these too; this button is for when you are looking at one now.
				</p>
			</Panel>

			<Panel title="Open review disputes">
				{disputes.length === 0 ? (
					<EmptyState>No maker is waiting on a second look.</EmptyState>
				) : (
					<Table head={["Project", "Phase", "Maker", "Asked", ""]}>
						{disputes.map((d) => (
							<tr key={d.id}>
								<td>{d.projectTitle}</td>
								<td>{d.phase.toLowerCase()}</td>
								<td>{d.participant}</td>
								<td className="hl-mono">{d.createdAt.toDateString()}</td>
								<td className="hl-row">
									<Link href={`/review/${d.submissionId}`}>Read</Link>
									<ActionButton
										url={`/api/admin/disputes/${d.id}/resolve`}
										body={{}}
										label="Resolve"
										confirm="Mark this dispute as looked at? The decision itself does not change."
									/>
								</td>
							</tr>
						))}
					</Table>
				)}
			</Panel>

			<Panel title="Ari review integration">
				<p className="hl-hint">
					Paste this callback URL into this program&apos;s webhook settings at ari.hackclub.com. Ari signs every
					delivery with <code>ARI_WEBHOOK_SECRET</code>, which is a different secret from the signing one; until the
					secrets are set, submission sends no-op and the webhook answers 503 rather than trusting an unverified body.
				</p>
				<Table head={["Setting", "Value", "Status"]}>
					<tr>
						<td>Callback URL</td>
						<td className="hl-mono" style={{ overflowWrap: "anywhere" }}>
							{callbackUrl}
						</td>
						<td>
							<Badge tone={ariReceiving ? "success" : "warning"}>{ariReceiving ? "listening" : "secret unset"}</Badge>
						</td>
					</tr>
					<tr>
						<td>Sending ships</td>
						<td className="hl-mono">ARI_PROGRAM_ID · ARI_SIGNING_SECRET</td>
						<td>
							<Badge tone={ariSending ? "success" : "muted"}>{ariSending ? "configured" : "not configured"}</Badge>
						</td>
					</tr>
					<tr>
						<td>Failed sends</td>
						<td className="hl-mono">POST /api/integrations/ari-retry</td>
						<td>
							<Badge tone="muted">hourly job</Badge>
						</td>
					</tr>
				</Table>
			</Panel>

			<Panel title="Tiers">
				{/* Tier values are code, not data: editing them is a pull request, and
            every review freezes the numbers it used, so changing them never
            rewrites anyone's history. */}
				<Table head={["Tier", "Grant", "Funded hours", "Submit floor"]}>
					{TIERS.map((tier) => (
						<tr key={tier.id}>
							<td>{tier.name}</td>
							<td>${tier.grantUsd}</td>
							<td>{tier.fundingHours}h</td>
							<td>{submitFloorFor(tier.fundingHours)}h</td>
						</tr>
					))}
				</Table>
				<p className="hl-hint">
					Edit these in <code>lib/config/tiers.ts</code>. Funded hours buy parts, and the submit floor is the funded
					hours and nothing more – every hour past them earns spendable coins.
				</p>

				<h2>Printer goals</h2>
				<Table head={["Printer", "Coins", "Earn pace / design week", "Tier 1 ask"]}>
					{PRINTERS.map((printer) => (
						<tr key={printer.id}>
							<td>{printer.name}</td>
							<td>{printer.coins}</td>
							<td>{printer.paceHours}h</td>
							<td>{printer.hoursPerWeek}h</td>
						</tr>
					))}
				</Table>
				<p className="hl-hint">
					Earning is paced by the machine, not the tier: the same printer asks the same weekly hours on every tier. Edit
					these in <code>lib/config/printers.ts</code>, which is the budget spreadsheet transcribed – the season lands
					exactly on each price.
				</p>
			</Panel>
		</div>
	)
}
