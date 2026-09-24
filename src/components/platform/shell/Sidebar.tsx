"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/lib/auth-client";
import Image from "next/image";
import { FoxAvatar } from "@/components/platform/art";
import logoArt from "../../../../public/art/logo.png";
import { IconLogout } from "@/components/platform/icons";
import { Panel, cx } from "@/components/platform/ui";
import { useStore } from "@/lib/store";
import { GoalTracker } from "./GoalTracker";
import { PLATFORM_HOME } from "@/lib/routes";

export const NAV = [
  { href: PLATFORM_HOME, label: "Home", tourId: "nav-home" },
  { href: "/doomscroller", label: "Doomscroller", tourId: "nav-doomscroller" },
  { href: "/projects", label: "Projects", tourId: "nav-projects" },
  { href: "/reels", label: "Reels", tourId: "nav-reels" },
  { href: "/explore", label: "Explore", tourId: "nav-explore" },
  { href: "/shop", label: "Shop", tourId: "nav-shop" },
  { href: "/docs", label: "Docs", tourId: "nav-docs" },
] as const;

/**
 * The phone tab bar divides into equal cells, six at most: six 60px cells is
 * what a 360px screen holds with the uppercase labels still readable. The
 * Doomscroller gets in through the header link below lg instead of taking one.
 */
export const TAB_NAV = NAV.filter((item) => item.href !== "/doomscroller");

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const { reset, viewer } = useStore();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className={cx("flex flex-col gap-5", className)}>
      {/* The same artwork the landing page leads with, so the platform reads as
          the place the site sent you. Sized to the rail, not to its own pixels:
          the file is drawn large, and priority because it is above the fold on
          every page. */}
      <Link href={PLATFORM_HOME} aria-label="Half Life home" className="block w-[176px] shrink-0 xl:w-[200px]">
        <Image
          src={logoArt}
          alt=""
          priority
          sizes="200px"
          className="h-auto w-full drop-shadow-[0_3px_6px_rgb(28_26_89/0.18)]"
        />
      </Link>

      <Panel tone="line" radius={18} className="relative bg-cream/60 pt-7 pb-5">
        <span
          aria-hidden="true"
          className="torn-soft absolute -top-3.5 left-8 h-8 w-20 rounded-t-lg bg-coral"
        />
        <nav className="relative px-5">
          <ul>
            {NAV.map((item) => {
              const active = item.href === PLATFORM_HOME ? pathname === PLATFORM_HOME : pathname.startsWith(item.href);
              return (
                <li key={item.href} data-tour={item.tourId} className="relative">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "group flex items-center justify-between gap-2 border-b border-dashed border-line py-3 text-[1.02rem] transition-colors",
                      active ? "font-extrabold text-navy" : "font-semibold text-navy-soft hover:text-navy",
                    )}
                  >
                    <span className="truncate">{item.label}</span>
                    {active && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-coral" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </Panel>

      {/* From xl up the goal rides the status rail on the right, where the
          Doomscroller lives. Below that there is no second rail, so it stays
          here — one instance is on screen at a time either way. */}
      <GoalTracker className="xl:hidden" />

      <Panel tone="line" radius={18} className="flex items-center gap-3.5 bg-cream/60 p-3.5">
        <FoxAvatar variant="fox-blueprint" className="size-[66px] shrink-0 rounded-lg" />
        <div className="min-w-0">
          <p className="truncate text-[1rem] leading-tight font-extrabold text-navy">{viewer.name}</p>
          <button
            type="button"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              try {
                await signOut();
                router.push("/login");
                router.refresh();
              } finally {
                setSigningOut(false);
              }
            }}
            className="label mt-2 inline-flex items-center gap-1.5 text-sky-deep transition-colors hover:text-coral"
          >
            {signingOut ? "Signing out…" : "Log out"} <IconLogout className="text-[0.95rem]" />
          </button>
        </div>
      </Panel>

      <button
        type="button"
        onClick={reset}
        className="hand -mt-1 self-start text-[0.76rem] text-line-strong underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
      >
        Replay the intro
      </button>
    </div>
  );
}
