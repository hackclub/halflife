"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FoxMark } from "@/components/platform/art";
import {
  IconBag,
  IconBook,
  IconCoin,
  IconCompass,
  IconFilm,
  IconFlame,
  IconHome,
  IconPencil,
  IconTrophy,
} from "@/components/platform/icons";
import { cx } from "@/components/platform/ui";
import { useStore } from "@/lib/store";
import { DoomscrollerFeed } from "./Doomscroller";
import { GoalTracker } from "./GoalTracker";
import { Sidebar, TAB_NAV } from "./Sidebar";
import { Overlays } from "@/components/platform/onboarding/Overlays";
import { PLATFORM_HOME } from "@/lib/routes";

const MOBILE_ICONS = {
  "/": IconHome,
  "/projects": IconPencil,
  "/explore": IconCompass,
  "/shop": IconBag,
  "/docs": IconBook,
  "/leaderboard": IconTrophy,
} as const;

function StatCluster() {
  const { coins, streak } = useStore();
  return (
    <div className="flex items-center gap-4 sm:gap-6">
      <span className="flex items-center gap-1.5" title={`${coins} coins banked`}>
        <IconCoin className="text-[1.45rem] text-orange" />
        <span className="text-[1.15rem] leading-none font-extrabold tabular-nums text-orange-deep">
          {coins}
        </span>
        <span className="sr-only">coins</span>
      </span>
      <span className="flex items-center gap-1.5" title={`${streak} day streak`}>
        <IconFlame className="text-[1.45rem] text-coral" />
        <span className="text-[1.15rem] leading-none font-extrabold tabular-nums text-coral-deep">
          {streak}
        </span>
        <span className="sr-only">day streak</span>
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { doomscrollerOpen, setDoomscroller, phase } = useStore();

  const cinematic = phase === "cinematic";
  // The Doomscroller page is this feed at full size. Running the rail feed
  // alongside it would put the same six reels on screen twice, so the route
  // wins — without touching the reader's own open/closed preference.
  const onDoomscroller = pathname.startsWith("/doomscroller");
  const rail = doomscrollerOpen && !onDoomscroller;

  return (
    <>
      <a
        href="#main"
        className="label sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:bg-navy focus:px-4 focus:py-2.5 focus:text-white"
      >
        Skip to content
      </a>

      <div
        className={cx(
          "relative z-10 mx-auto flex w-full max-w-[1760px] transition-[filter,opacity] duration-500",
          cinematic && "pointer-events-none",
        )}
        aria-hidden={cinematic || undefined}
      >
        {/* ---------- left rail ---------- */}
        <aside className="sticky top-0 hidden h-dvh w-[246px] shrink-0 overflow-y-auto border-r border-dashed border-line px-5 py-6 lg:block xl:w-[286px] xl:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Sidebar />
        </aside>

        {/* ---------- centre + feed ---------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-dashed border-line/70 bg-cream/85 px-4 backdrop-blur-md sm:px-6 lg:border-b-0 lg:bg-transparent lg:backdrop-blur-none">
            <Link href={PLATFORM_HOME} aria-label="Half Life home" className="w-11 shrink-0 lg:hidden">
              <FoxMark className="sticker-shadow w-full" />
            </Link>
            <div className="min-w-0 flex-1" />

            {/* Puts the rail back, under the product's own name for it. A
                second control labelled "Reels" would compete with the nav
                item while doing something different. */}
            {!rail && !onDoomscroller && (
              <button
                type="button"
                onClick={() => setDoomscroller(true)}
                className="label hidden items-center gap-1.5 rounded-full border-2 border-line px-3 py-1.5 text-navy-soft transition-colors hover:border-sky hover:text-navy xl:inline-flex"
              >
                <IconFilm className="text-base" /> Doomscroller
              </button>
            )}

            {/* Below lg there is no sidebar, so this is the way to the page. */}
            {!onDoomscroller && (
              <Link
                href="/doomscroller"
                data-tour="doomscroller-button"
                className="label inline-flex items-center gap-1.5 rounded-full border-2 border-line px-3 py-1.5 text-navy-soft transition-colors hover:border-sky hover:text-navy lg:hidden"
              >
                <IconFilm className="text-base" /> Doomscroller
              </Link>
            )}

            <StatCluster />
          </header>

          <div className="flex min-w-0 flex-1">
            <main id="main" className="min-w-0 flex-1 pb-28 lg:pb-10">
              {children}
            </main>

            {/* The status rail. Its width is fixed so the trail down the middle
                never reflows underneath the reader — only the feed inside it
                opens and closes, and the goal stays up whatever it does. */}
            <aside className="sticky top-16 hidden h-[calc(100dvh_-_4rem)] w-[316px] shrink-0 flex-col overflow-hidden py-4 pr-5 pl-1 xl:flex 2xl:w-[352px] 2xl:pr-7">
              <GoalTracker className="shrink-0" />

              {/* Stays mounted through the close so the feed slides shut
                  rather than vanishing — closing is often something the page
                  did, not something the reader asked for. */}
              <div
                data-tour={rail ? "doomscroller" : undefined}
                inert={!rail}
                className={cx(
                  "flex min-h-0 overflow-hidden",
                  "transition-[flex-grow,margin,opacity] duration-[420ms] ease-[cubic-bezier(.16,1,.3,1)]",
                  rail ? "mt-4 flex-1 opacity-100" : "mt-0 flex-[0_1_0%] opacity-0",
                )}
              >
                <DoomscrollerFeed className="min-h-0 w-full" onClose={() => setDoomscroller(false)} />
              </div>
            </aside>
          </div>
        </div>
      </div>

      {/* ---------- mobile tab bar ---------- */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-cream/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg">
          {TAB_NAV.map((item) => {
            const Icon = MOBILE_ICONS[item.href as keyof typeof MOBILE_ICONS];
            const active = item.href === PLATFORM_HOME ? pathname === PLATFORM_HOME : pathname.startsWith(item.href);
            return (
              <li key={item.href} data-tour={item.tourId} className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex flex-col items-center gap-1 py-2.5 transition-colors",
                    active ? "text-navy" : "text-navy-soft",
                  )}
                >
                  <Icon className="text-[1.45rem]" />
                  <span className="label w-full truncate text-center text-[0.6rem] tracking-[0.06em]">
                    {"short" in item ? item.short : item.label}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cx("h-1 w-6 rounded-full transition-colors", active ? "bg-coral" : "bg-transparent")}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Overlays />
    </>
  );
}
