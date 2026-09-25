import { ActionButton } from "@/app/components/forms/ActionButton"
import { ProgramSettingsForm } from "@/app/components/forms/ProgramSettingsForm"
import { ProgramStartForm } from "@/app/components/forms/ProgramStartForm"
import { Badge, EmptyState, PageHeader, Panel, Table } from "@/app/components/ui"
import { Phase } from "@/app/generated/prisma/enums"
import { findUnsyncedSubmissions } from "@/lib/airtable/sync"
import { PRINTERS, submitFloorFor } from "@/lib/config/printers"
import { scheduleForWeek, TOTAL_WEEKS } from "@/lib/config/program"
import { TIERS } from "@/lib/config/tiers"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { currentWeekNumber, getProgramSettings, weekClosesAt, weekDateRange } from "@/lib/program"

export const dynamic = "force-dynamic"

export default async function AdminProgramPage() {
  await requirePermissionPage(Permission.MANAGE_PROGRAM)

  const [settings, week, unsynced] = await Promise.all([
    getProgramSettings(),
    currentWeekNumber(),
    findUnsyncedSubmissions(),
  ])

  const startYmd = settings.eventStartDate.toISOString().slice(0, 10)
  const now = new Date()
  const inZone = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    d.toLocaleString("en-US", { timeZone: settings.programTimezone, ...opts })
  const schedule = Array.from({ length: TOTAL_WEEKS }, (_, i) => {
    const n = i + 1
    const slot = scheduleForWeek(n)
    const range = weekDateRange(settings.eventStartDate, n)
    const closesAt = weekClosesAt(settings, n)
    // A week opens as the one before it closes; "week 0" closing is midnight
    // on the start date itself, in the program's timezone.
    const opensAt = weekClosesAt(settings, n - 1)
    const day = { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" } as const
    return {
      week: n,
      label: slot ? `${slot.theme.label} · ${slot.phase === Phase.DESIGN ? "design" : "build"}` : "—",
      runs: range
        ? `${range.start.toLocaleDateString("en-US", day)} – ${new Date(range.start.getTime() + 6 * 86_400_000).toLocaleDateString("en-US", day)}`
        : "—",
      closes: inZone(closesAt, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
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
          A passed week is shut on the trail: no more journal entries, only its Submit. An extension on the user or the
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
            shopOpen: settings.shopOpen,
            shopGraceDays: settings.shopGraceDays,
            reviewClaimTtlMinutes: settings.reviewClaimTtlMinutes,
            airtableSyncEnabled: settings.airtableSyncEnabled,
          }}
        />
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
          Edit these in <code>lib/config/tiers.ts</code>. Funded hours buy parts. The submit floor is the funded hours
          plus enough banking to keep the cheapest machine reachable — hand a week in under it and the season cannot end
          in a printer.
        </p>

        <h2>Printer goals</h2>
        <Table head={["Printer", "Coins", "Banked hours / design week", "Tier 1 ask"]}>
          {PRINTERS.map((printer) => (
            <tr key={printer.id}>
              <td>{printer.name}</td>
              <td>{printer.coins}</td>
              <td>{printer.bankedHours}h</td>
              <td>{printer.hoursPerWeek}h</td>
            </tr>
          ))}
        </Table>
        <p className="hl-hint">
          Banking is paced by the machine, not the tier: every tier banks the same hours for the same printer. Edit
          these in <code>lib/config/printers.ts</code>, which is the budget spreadsheet transcribed — the season lands
          exactly on each price.
        </p>
      </Panel>
    </div>
  )
}
