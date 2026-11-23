import type { Metadata, Route } from "next"
import Link from "next/link"
import { TabKeys } from "@/app/components/admin/TabKeys"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { AirtableImportForm } from "@/app/components/forms/AirtableImportForm"
import { CsvProjectsImport } from "@/app/components/forms/CsvProjectsImport"
import { ProgramSettingsForm } from "@/app/components/forms/ProgramSettingsForm"
import { ProgramStartForm } from "@/app/components/forms/ProgramStartForm"
import { Badge, EmptyState, PageHeader, Panel, Table } from "@/app/components/ui"
import { getAirtableConfig } from "@/lib/airtable/client"
import { YSWS_SUBMISSION } from "@/lib/airtable/schema"
import { findUnsyncedSubmissions } from "@/lib/airtable/sync"
import { ariWebhookUrl, findUnsyncedAriSubmissions, isAriConfigured, isAriWebhookConfigured } from "@/lib/ari"
import { PRINTERS, submitFloorFor } from "@/lib/config/printers"
import { scheduleForWeek, TOTAL_WEEKS, themeLabel } from "@/lib/config/program"
import { TIERS } from "@/lib/config/tiers"
import { formatDeadline, formatUtcDate } from "@/lib/deadline"
import { Phase } from "@/lib/enums"
import { ireMode, ireWebhookUrl, isIreConfigured } from "@/lib/ire-platform"
import { findUnsyncedIreSubmissions } from "@/lib/ire-shadow"
import { ireQueueUrl } from "@/lib/ire-url"
import { configuredOrigin } from "@/lib/origin"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { currentWeekNumber, getProgramSettings, weekClosesAt, weekOpensAt } from "@/lib/program"
import { getOpenDisputes } from "@/lib/queries/review"
import { uncheckedRoute } from "@/lib/routes"
import { firstValues, type SearchParamValue } from "@/lib/search-params"

export const metadata: Metadata = {
	title: "Program settings",
}

export const dynamic = "force-dynamic"

/** The tabs in the order the chips and the [ and ] keys step through them. */
const TABS = [
	{ id: "season", label: "Season" },
	{ id: "imports", label: "Imports" },
	{ id: "queue", label: "Queue" },
	{ id: "integrations", label: "Integrations" },
] as const

type ProgramTab = (typeof TABS)[number]["id"]

const tabHref = (id: ProgramTab): Route => (id === "season" ? "/admin/program" : `/admin/program?tab=${id}`)

interface Props {
	searchParams: Promise<{ tab?: SearchParamValue }>
}

export default async function AdminProgramPage({ searchParams }: Props) {
	await requirePermissionPage(Permission.MANAGE_PROGRAM)
	// The tab, taken as the single value the URL named: a repeated parameter arrives as an array, which is not a tab.
	const { tab: requestedTab } = firstValues(await searchParams)
	const tab: ProgramTab = TABS.find(item => item.id === requestedTab)?.id ?? "season"
	const week = await currentWeekNumber()

	return (
		<div className="hl-stack">
			<PageHeader
				actions={
					<div className="hl-row">
						{TABS.map((item, index) => (
							<Link
								aria-current={item.id === tab || undefined}
								aria-keyshortcuts={`Alt+${index + 1}`}
								className="hl-chip"
								href={tabHref(item.id)}
								key={item.id}
							>
								{item.label}
								<kbd className="hl-hotkey hl-tab-key">{index + 1}</kbd>
							</Link>
						))}
					</div>
				}
				compact
				subtitle={
					week < 1
						? "The program has not started yet."
						: week > TOTAL_WEEKS
							? "The program is over."
							: `Currently week ${week} of ${TOTAL_WEEKS}.`
				}
				title="Program settings"
			/>
			<TabKeys current={tabHref(tab)} hrefs={TABS.map(item => tabHref(item.id))} />

			{tab === "season" ? <SeasonTab /> : null}
			{tab === "imports" ? <ImportsTab /> : null}
			{tab === "queue" ? <QueueTab /> : null}
			{tab === "integrations" ? <IntegrationsTab /> : null}
		</div>
	)
}

/** Season: when it starts, the week schedule, the settings that steer it, and the figures it pays by. Only its own queries run when this tab is open. */
async function SeasonTab() {
	const settings = await getProgramSettings()
	const startYmd = settings.eventStartDate.toISOString().slice(0, 10)
	const now = new Date()
	const schedule = Array.from({ length: TOTAL_WEEKS }, (_, i) => {
		const n = i + 1
		const slot = scheduleForWeek(n)
		const closesAt = weekClosesAt(settings, n)
		const opensAt = weekOpensAt(settings, n)
		return {
			// Both columns print through the same formatter, in the program's own timezone, so the two dates read as one pair: "Mon, Sep 7 at 12:00 AM" and "Sun, Sep 13 at 11:59 PM".
			closes: formatDeadline(closesAt, settings.programTimezone, "short"),
			label: slot ? `${themeLabel(slot.theme.id)} · ${slot.phase === Phase.DESIGN ? "design" : "build"}` : "-",
			opens: formatDeadline(opensAt, settings.programTimezone, "short"),
			state: now >= closesAt ? "passed" : now >= opensAt ? "current" : "upcoming",
			week: n,
		}
	})

	return (
		<>
			<Panel title="Program start">
				<ProgramStartForm initial={startYmd} timezone={settings.programTimezone} weeks={schedule.map(w => w.label)} />
			</Panel>

			<Panel title="Schedule">
				<Table head={["Week", "Theme", "Opens", "Closes", ""]}>
					{schedule.map(w => (
						<tr key={w.week}>
							<td className="hl-mono">{w.week}</td>
							<td>{w.label}</td>
							<td>{w.opens}</td>
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
				{/* These live in the database rather than env vars on purpose: stasis put its submission gate in an env var, nobody flipped it, and submissions stayed open for two weeks after the event ended. */}
				<ProgramSettingsForm
					initial={{
						airtableSyncEnabled: settings.airtableSyncEnabled,
						payoutSource: settings.payoutSource,
						programTimezone: settings.programTimezone,
						repoSyncEnabled: settings.repoSyncEnabled,
						reviewClaimTtlMinutes: settings.reviewClaimTtlMinutes,
						shopClosesAt: settings.shopClosesAt?.toISOString().slice(0, 16) ?? null,
						shopGraceDays: settings.shopGraceDays,
						shopOpen: settings.shopOpen,
						submissionsCloseAt: settings.submissionsCloseAt?.toISOString().slice(0, 16) ?? null,
						submissionsOpen: settings.submissionsOpen,
					}}
				/>
			</Panel>
			<Panel title="Tiers">
				{/* Tier values are code, not data: editing them is a pull request, and every review freezes the numbers it used, so changing them never rewrites anyone's history. */}
				<Table head={["Tier", "Grant", "Funded hours", "Submit floor"]}>
					{TIERS.map(tier => (
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
					hours and nothing more. Every hour past them earns spendable coins.
				</p>

				<h2>Printer goals</h2>
				<Table head={["Printer", "Coins", "Earn pace / design week", "Tier 1 ask"]}>
					{PRINTERS.map(printer => (
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
					these in <code>lib/config/printers.ts</code>, which is the budget spreadsheet transcribed, so the season lands
					exactly on each price.
				</p>
			</Panel>
		</>
	)
}

/** Imports: the pre-season projects, from Airtable or a CSV export. */
function ImportsTab() {
	const airtableReady = getAirtableConfig() !== null
	const ariSending = isAriConfigured()

	return (
		<>
			<Panel title="Warm-up projects from Airtable">
				<p className="hl-hint">
					Before the platform opened, projects were submitted through the warm-up submission form, which writes rows
					into the <code>{YSWS_SUBMISSION.tableId}</code> table (<code>AIRTABLE_YSWS_TABLE_ID</code>). Importing files
					each one on the maker&apos;s Warm Up track (a pre-season slot that does not use one of their five season
					themes), creates their account if they have not signed up yet, records the self-reported hours as a work
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
					Import a CSV exported from Macondo (project_id, project_title, project_description, journals, tier,
					author_email, repository_url, thumbnail_url, and the rest). Each row becomes its own warm-up project on the
					same Warm Up track (a pre-season slot that does not use one of the five season themes), with an account
					created if the row&apos;s email has none, and one work session filed per entry in the row&apos;s journals
					column. Rows already imported are reported instead of duplicated, so the button is safe to run again.
				</p>
				<CsvProjectsImport />
			</Panel>
		</>
	)
}

/** Queue: hand-ins that never reached Airtable or Ari, and disputes waiting on a second look. */
async function QueueTab() {
	const ariSending = isAriConfigured()
	const [unsynced, disputes, unsyncedAri] = await Promise.all([
		findUnsyncedSubmissions(),
		getOpenDisputes(),
		ariSending ? findUnsyncedAriSubmissions() : Promise.resolve([]),
	])

	return (
		<>
			<Panel title="Submissions that never reached Airtable">
				{unsynced.length === 0 ? (
					<EmptyState>Every submission awaiting review is in the YSWS table.</EmptyState>
				) : (
					<Table head={["Project", "Phase", ""]}>
						{unsynced.map(item => (
							<tr key={`${item.themeProjectId}-${item.phase}`}>
								<td className="hl-mono">{item.themeProjectId}</td>
								<td>{item.phase.toLowerCase()}</td>
								<td>
									<ActionButton
										body={{ phase: item.phase }}
										label="Retry"
										url={`/api/admin/theme-projects/${item.themeProjectId}/sync-to-airtable`}
									/>
								</td>
							</tr>
						))}
					</Table>
				)}
			</Panel>

			<Panel title="Submissions that never reached Ari">
				{ariSending ? (
					unsyncedAri.length === 0 ? (
						<EmptyState>Every submission awaiting review is in Ari.</EmptyState>
					) : (
						<Table head={["Project", "Phase", "Why it's stuck", ""]}>
							{unsyncedAri.map(item => (
								<tr key={`${item.themeProjectId}-${item.phase}`}>
									<td className="hl-mono">{item.themeProjectId}</td>
									<td>{item.phase.toLowerCase()}</td>
									<td>{item.reason ?? "Not attempted yet. The retry job will pick it up."}</td>
									<td>
										<ActionButton
											body={{ phase: item.phase }}
											label="Retry"
											url={`/api/admin/theme-projects/${item.themeProjectId}/sync-to-ari`}
										/>
									</td>
								</tr>
							))}
						</Table>
					)
				) : (
					<EmptyState>Ari is not configured on this deployment, so nothing is sent there.</EmptyState>
				)}
				<p className="hl-hint">
					A ship is what the reviewer sees, so a submission missing from Ari is a submission nobody will decide. The
					hourly retry job replays these too; this button is for when you are looking at one now. Rows failing on a
					missing Slack account or repo need the maker, not another retry.
				</p>
			</Panel>

			<Panel title="Open review disputes">
				{disputes.length === 0 ? (
					<EmptyState>No maker is waiting on a second look.</EmptyState>
				) : (
					<Table head={["Project", "Phase", "Maker", "Replies", "Asked", ""]}>
						{disputes.map(d => (
							<tr key={d.id}>
								<td>{d.projectTitle}</td>
								<td>{d.phase.toLowerCase()}</td>
								<td>{d.participant}</td>
								<td className="hl-mono">{d.messageCount}</td>
								<td className="hl-mono">{formatUtcDate(d.createdAt)}</td>
								<td className="hl-row">
									<Link href={`/review/${d.submissionId}`}>Open thread</Link>
								</td>
							</tr>
						))}
					</Table>
				)}
			</Panel>
		</>
	)
}

/** Integrations: the callback URLs and secrets each reviewer platform needs, with the sends still stuck. */
async function IntegrationsTab() {
	const origin = configuredOrigin()
	const ariSending = isAriConfigured()
	const ariReceiving = isAriWebhookConfigured()
	// The callback URL to register with Ari, from the configured public origin and nothing else. The request's own host used to be the fallback, but that host is whatever the caller put in the `Host` header: a callback URL built from it would send every Ari delivery to a host of the caller's choosing. A deployment that configures no public origin has no callback URL to show, and says so rather than naming one.
	const callbackUrl = origin ? ariWebhookUrl(origin) : null
	const ireSending = isIreConfigured()
	const ireCallbackUrl = origin && ireSending ? ireWebhookUrl(origin) : null
	const ireQueue = ireQueueUrl()
	const unsyncedIre = ireSending ? await findUnsyncedIreSubmissions() : []

	return (
		<>
			<Panel title="Ari review integration">
				<p className="hl-hint">
					Paste this callback URL into this program&apos;s webhook settings at ari.hackclub.com. Ari signs every
					delivery with <code>ARI_WEBHOOK_SECRET</code>, which is a different secret from the signing one; until the
					secrets are set, submission sends no-op and the webhook answers 503 rather than trusting an unverified body.
				</p>
				<Table head={["Setting", "Value", "Status"]}>
					<tr>
						<td>Callback URL</td>
						{callbackUrl ? (
							<td className="hl-mono" style={{ overflowWrap: "anywhere" }}>
								{callbackUrl}
							</td>
						) : (
							<td className="hl-hint">The public app URL is not configured on this deployment</td>
						)}
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

			<Panel title={`Ire ${ireMode() === "live" ? "live" : "shadow"} integration`}>
				<p className="hl-hint">
					{ireMode() === "live"
						? "Ire owns review on this deployment: hand-ins go to Ire exclusively and its decisions apply through finalizeReview. The hourly job replays missed sends and reconciles standing decisions the webhook never delivered."
						: "Half Life sends every hand-in to Ire as a shadow copy while Ari remains the decision surface. The copy is read-only: Ire reviewers cannot claim or decide it, and nothing Ire does can write credit, Airtable or a maker notification. When a phase leaves review, the hourly job withdraws its copy."}
				</p>
				<Table head={["Setting", "Value", "Status"]}>
					<tr>
						<td>Mode</td>
						<td className="hl-mono">IRE_MODE</td>
						<td>
							<Badge tone={ireMode() === "shadow" ? "warning" : "success"}>{ireMode()}</Badge>
						</td>
					</tr>
					<tr>
						<td>Sending ships</td>
						<td className="hl-mono">IRE_API_URL · IRE_PROGRAM · IRE_SIGNING_SECRET</td>
						<td>
							<Badge tone={ireSending ? "success" : "muted"}>{ireSending ? "configured" : "not configured"}</Badge>
						</td>
					</tr>
					<tr>
						<td>Callback URL</td>
						{ireCallbackUrl ? (
							<td className="hl-mono" style={{ overflowWrap: "anywhere" }}>
								{ireCallbackUrl}
							</td>
						) : (
							<td className="hl-hint">Set the public app URL and the Ire secrets to show a callback URL</td>
						)}
						<td>
							<Badge tone={ireCallbackUrl ? "muted" : "warning"}>
								{ireCallbackUrl ? "ready for the live phase" : "not configured"}
							</Badge>
						</td>
					</tr>
					<tr>
						<td>Queue</td>
						{ireQueue ? (
							<td className="hl-mono" style={{ overflowWrap: "anywhere" }}>
								{/* Operator-configured, so it may be a path or an absolute URL. */}
								<Link href={uncheckedRoute(ireQueue)}>{ireQueue}</Link>
							</td>
						) : (
							<td className="hl-hint">Set IRE_API_URL or IRE_BASE to link the queue</td>
						)}
						<td>
							<Badge tone={ireMode() === "live" ? "success" : "muted"}>
								{ireMode() === "live" ? "live" : "shadow"}
							</Badge>
						</td>
					</tr>
					<tr>
						<td>Failed sends and closes</td>
						<td className="hl-mono">POST /api/integrations/ire-retry</td>
						<td>
							<Badge tone="muted">hourly job</Badge>
						</td>
					</tr>
				</Table>

				{ireSending ? (
					unsyncedIre.length === 0 ? (
						<EmptyState>
							{ireMode() === "live"
								? "Every submission awaiting review has a healthy ship in Ire."
								: "Every submission awaiting review has a healthy shadow copy in Ire."}
						</EmptyState>
					) : (
						<Table head={["Project", "Phase", "Why it is stuck", ""]}>
							{unsyncedIre.map(item => (
								<tr key={`ire-${item.themeProjectId}-${item.phase}`}>
									<td className="hl-mono">{item.themeProjectId}</td>
									<td>{item.phase.toLowerCase()}</td>
									<td>{item.reason ?? "Not sent yet. The hourly job will pick it up."}</td>
									<td>
										<ActionButton
											body={{ phase: item.phase }}
											label="Retry"
											url={`/api/admin/theme-projects/${item.themeProjectId}/sync-to-ire`}
										/>
									</td>
								</tr>
							))}
						</Table>
					)
				) : (
					<EmptyState>Ire is not configured on this deployment, so nothing is sent there.</EmptyState>
				)}
			</Panel>
		</>
	)
}
