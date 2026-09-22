import type { Metadata } from "next";
import { FoxAvatar } from "@/components/platform/art";
import { IconFlame, IconTrophy } from "@/components/platform/icons";
import { PageSign } from "@/components/platform/PageSign";
import { Panel } from "@/components/platform/ui";
import { cx } from "@/lib/cx";
import { requireSessionPage } from "@/lib/page-guards";
import { getLeaderboard } from "@/lib/queries/community";

export const metadata: Metadata = {
  title: "Half Life Leaderboard",
  description: "Hours logged and weeks shipped across the whole program.",
};

const AVATARS: [string, string, string, string, string] = [
  "fox-goggles",
  "fox-solder",
  "fox-plain",
  "fox-cap",
  "fox-blueprint",
];

const MEDAL = ["#f6c63f", "#c6cdd6", "#d59b63"];

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const { user } = await requireSessionPage();
  const rows = await getLeaderboard(user.id);
  const top = rows[0];

  return (
    <div className="mx-auto w-full max-w-[820px] px-4 pt-2 sm:px-8">
      <PageSign
        label="LEADERBOARD"
        color="var(--color-magenta)"
        ink="#ffffff"      />

      {top && (
      <Panel tone="gold" radius={22} className="mb-6 flex items-center gap-4 bg-gold-pale px-5 py-4 sm:px-7">
        <IconTrophy className="shrink-0 text-[2rem] text-gold-deep" />
        <div className="min-w-0">
          <p className="label text-gold-deep">Leading this week</p>
          <p className="mt-0.5 text-[1.2rem] leading-tight font-extrabold text-navy">
            {top.name} — {top.hours} hours, {top.ships} weeks shipped
          </p>
        </div>
      </Panel>
      )}

      <Panel tone="line" radius={20} className="overflow-hidden bg-paper">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left">
            <thead>
              <tr className="border-b border-dashed border-line">
                <th scope="col" className="label px-4 py-3 text-navy-soft sm:px-6">
                  #
                </th>
                <th scope="col" className="label px-2 py-3 text-navy-soft">
                  Builder
                </th>
                <th scope="col" className="label px-3 py-3 text-right text-navy-soft">
                  Hours
                </th>
                <th scope="col" className="label px-3 py-3 text-right text-navy-soft">
                  Shipped
                </th>
                <th scope="col" className="label px-4 py-3 text-right text-navy-soft sm:px-6">
                  Streak
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.name + row.rank}
                  className={cx(
                    "border-b border-dashed border-line/60 last:border-0",
                    row.you && "bg-mint/60",
                  )}
                >
                  <td className="px-4 py-3 sm:px-6">
                    <span
                      className="grid size-8 place-items-center rounded-full text-[0.86rem] font-extrabold text-navy tabular-nums"
                      style={{ background: MEDAL[i] ?? "rgba(28,26,89,.07)" }}
                    >
                      {row.rank}
                    </span>
                  </td>
                  <td className="px-2 py-3">
                    <span className="flex items-center gap-3">
                      <FoxAvatar
                        variant={AVATARS[i % AVATARS.length] ?? AVATARS[0]}
                        className="size-9 shrink-0 rounded-md"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[0.98rem] leading-tight font-extrabold text-navy">
                          {row.name}
                          {row.you && <span className="label ml-2 text-teal-deep">you</span>}
                        </span>
                        <span className="hand block truncate text-[0.78rem] text-navy-soft">
                          {row.ships === 1 ? "1 week shipped" : `${row.ships} weeks shipped`}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right text-[0.98rem] font-bold text-navy tabular-nums">
                    {row.hours}
                  </td>
                  <td className="px-3 py-3 text-right text-[0.98rem] font-bold text-navy tabular-nums">
                    {row.ships}
                  </td>
                  <td className="px-4 py-3 text-right sm:px-6">
                    <span className="inline-flex items-center gap-1 text-[0.98rem] font-bold text-coral-deep tabular-nums">
                      <IconFlame className="text-base text-coral" />
                      {row.streak}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="hand py-10 text-center text-[0.86rem] text-navy-soft">
        ranks update every night. logged hours only count once the journal entry is in.
      </p>
    </div>
  );
}
