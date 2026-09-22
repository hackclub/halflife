import type { Metadata } from "next";
import { FoxAvatar } from "@/components/platform/art";
import { Markdown } from "@/components/platform/Markdown";
import { IconClock, IconFlame } from "@/components/platform/icons";
import { PageSign } from "@/components/platform/PageSign";
import { Panel } from "@/components/platform/ui";
import { requireSessionPage } from "@/lib/page-guards";
import { getJournalFeed, type JournalRow } from "@/lib/queries/community";
import { getProgramSettings, effectiveDateFor } from "@/lib/program";

export const metadata: Metadata = {
  title: "Half Life Explore",
  description: "Journal entries from everyone building hardware this week.",
};

export const dynamic = "force-dynamic";

const GROUPS = ["Today", "Yesterday", "Earlier"] as const;
type Group = (typeof GROUPS)[number];

/**
 * Which heading an entry sits under.
 *
 * Bucketed against the PROGRAM's day rather than the reader's: an entry is
 * stamped with the date it counted for, in the program timezone, and that is
 * the same stamp the streak is built from. Comparing it to a browser clock in
 * another timezone would put yesterday's work under "Today" for half the world.
 */
function groupFor(day: string, today: string, yesterday: string): Group {
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return "Earlier";
}

/** A fox for a name, so the same person keeps the same one. */
const AVATARS = ["fox-goggles", "fox-solder", "fox-plain", "fox-cap", "fox-blueprint"] as const;
function avatarFor(name: string): string {
  let n = 0;
  for (const ch of name) n = (n + ch.charCodeAt(0)) % AVATARS.length;
  return AVATARS[n] ?? AVATARS[0];
}

function fmtMinutes(m: number) {
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return h > 0 ? `${h}h ${rest.toString().padStart(2, "0")}m` : `${rest}m`;
}

function Entry({ entry }: { entry: JournalRow }) {
  return (
    <Panel tone="line" radius={20} as="article" className="bg-paper px-5 py-5 sm:px-7 sm:py-6">
      <header className="flex flex-wrap items-start gap-3.5">
        <FoxAvatar variant={avatarFor(entry.author)} className="size-11 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[1.02rem] leading-tight font-extrabold text-navy">
            {entry.author}{" "}
            <span className="font-semibold text-navy-soft">on</span>{" "}
            <span className="text-navy">{entry.project}</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="hand inline-flex items-center gap-1 text-[0.82rem] text-coral-deep tabular-nums">
              <IconFlame className="text-sm text-coral" /> {entry.streak}
            </span>
            <span className="hand inline-flex items-center gap-1 text-[0.82rem] text-navy-soft tabular-nums">
              <IconClock className="text-sm" /> {fmtMinutes(entry.minutes)}
            </span>
          </p>
        </div>
        <time dateTime={entry.when} className="label shrink-0 pt-1 text-line-strong">
          {entry.day}
        </time>
      </header>

      {/* Journals are written in Markdown, images included — the pictures that
          back a session live inside the sentence that explains them, so the
          entry renders whole rather than with a tray of photos underneath. */}
      <Markdown
        source={entry.body}
        className="mt-4 grid max-w-[68ch] gap-3 text-[0.95rem] leading-relaxed text-navy"
      />
    </Panel>
  );
}

export default async function ExplorePage() {
  await requireSessionPage();
  const [entries, settings] = await Promise.all([getJournalFeed(), getProgramSettings()]);

  const now = new Date();
  const today = effectiveDateFor(now, settings.programTimezone);
  const yesterday = effectiveDateFor(
    new Date(now.getTime() - 24 * 60 * 60 * 1000),
    settings.programTimezone,
  );

  return (
    <div className="mx-auto w-full max-w-[780px] px-4 pt-2 sm:px-8">
      <PageSign
        label="EXPLORE"
        color="var(--color-sky)"
        sub="See what other teenagers around the world are building for Half Life!"
      />

      <div className="grid gap-6">
        {GROUPS.map((group) => {
          const items = entries.filter((e) => groupFor(e.day, today, yesterday) === group);
          if (items.length === 0) return null;
          return (
            <section key={group} className="grid gap-5">
              <div className="flex items-center gap-4">
                <span className="h-px flex-1 bg-line" />
                <h2 className="label text-line-strong">{group}</h2>
                <span className="h-px flex-1 bg-line" />
              </div>
              {items.map((e) => (
                <Entry key={e.id} entry={e} />
              ))}
            </section>
          );
        })}
      </div>

      <p className="hand py-10 text-center text-[0.86rem] text-navy-soft">
        {entries.length === 0
          ? "nobody has journalled yet. be the first."
          : "that is as far back as the feed goes."}
      </p>
    </div>
  );
}
