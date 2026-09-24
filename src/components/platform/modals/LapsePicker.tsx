"use client";

import { useCallback, useEffect, useState } from "react";
import { IconArrowRight, IconCheck, IconClock, IconFilm, IconWarning } from "@/components/platform/icons";
import { Button, Chip, cx } from "@/components/platform/ui";

export interface LapseTimelapse {
  id: string;
  title: string;
  durationSeconds: number;
  visibility: "PUBLIC" | "UNLISTED" | "FAILED_PROCESSING";
  createdAt: number;
  thumbnailUrl: string | null;
  hackatimeProject: string | null;
  processing: boolean;
  attached: boolean;
}

type Load =
  | { state: "loading" }
  | { state: "unlinked" }
  | { state: "error"; message: string }
  | { state: "ready"; items: LapseTimelapse[]; nextCursor: string | null };

const LAPSE_URL = "https://lapse.hackclub.com";

/** Recorded time, the way a person says it: 45m, 1h 20m, 2h. */
export function fmtDuration(seconds: number) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

async function fetchPage(cursor?: string) {
  const query = new URLSearchParams(cursor ? { cursor } : {});
  const res = await fetch(`/api/lapse/timelapses?${query}`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const code = body?.error?.code as string | undefined;
    if (code === "LAPSE_NOT_LINKED") return { unlinked: true as const };
    throw new Error(body?.error?.message ?? "Could not load your timelapses");
  }
  return body as { timelapses: LapseTimelapse[]; nextCursor: string | null };
}

/**
 * Pick the Lapse timelapses that back this entry.
 *
 * Timelapses are recorded on Lapse, not here. This lists what the maker has
 * published there and lets them tick the ones for this session. A timelapse is
 * offered only once it is finished and not already claimed by another entry —
 * one recording backs one session, and the server holds to both rules whatever
 * this shows.
 */
export function LapsePicker({
  picked,
  onToggle,
  onSignIn,
}: {
  picked: LapseTimelapse[];
  onToggle: (t: LapseTimelapse) => void;
  /** Leaves the page for Lapse; the caller stashes the draft first. */
  onSignIn: () => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [more, setMore] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const page = await fetchPage();
      if ("unlinked" in page) setLoad({ state: "unlinked" });
      else setLoad({ state: "ready", items: page.timelapses, nextCursor: page.nextCursor });
    } catch (err) {
      setLoad({ state: "error", message: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching on mount
    void refresh();
  }, [refresh]);

  async function loadMore() {
    if (load.state !== "ready" || !load.nextCursor) return;
    setMore(true);
    try {
      const page = await fetchPage(load.nextCursor);
      if ("unlinked" in page) setLoad({ state: "unlinked" });
      else
        setLoad({
          state: "ready",
          items: [...load.items, ...page.timelapses],
          nextCursor: page.nextCursor,
        });
    } catch (err) {
      setLoad({ state: "error", message: (err as Error).message });
    } finally {
      setMore(false);
    }
  }

  if (load.state === "loading") {
    return (
      <p className="hand py-10 text-center text-[0.9rem] text-navy-soft" aria-live="polite">
        looking for your timelapses on Lapse…
      </p>
    );
  }

  if (load.state === "unlinked") {
    return (
      <div
        className="sketch grid justify-items-center gap-3 rounded-2xl bg-violet-pale px-6 py-8 text-center"
        style={{ "--sk-color": "var(--color-violet)", "--sk-radius": "18px" } as React.CSSProperties}
      >
        <span className="grid size-12 place-items-center rounded-full bg-violet text-white">
          <IconFilm className="text-xl" />
        </span>
        <p className="max-w-[40ch] text-[0.92rem] leading-snug text-navy">
          Timelapses are recorded on Lapse. Sign in once and every timelapse you publish there shows
          up here to pick from.
        </p>
        <Button
          variant="solid"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            onSignIn();
          }}
        >
          {leaving ? "Opening Lapse…" : "Sign in with Lapse"} <IconArrowRight className="text-base" />
        </Button>
        <p className="hand text-[0.78rem] text-navy-soft">
          you&apos;ll come straight back here, with your entry as you left it.
        </p>
      </div>
    );
  }

  if (load.state === "error") {
    return (
      <div className="grid justify-items-center gap-3 py-8 text-center">
        <p role="alert" className="flex items-start gap-2 text-[0.88rem] font-semibold text-coral-deep">
          <IconWarning className="mt-0.5 shrink-0 text-base" /> {load.message}
        </p>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          Try again
        </Button>
      </div>
    );
  }

  const pickedIds = new Set(picked.map((p) => p.id));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <a
          href={`${LAPSE_URL}/timelapse/create`}
          target="_blank"
          rel="noreferrer"
          className="hand text-[0.82rem] text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
        >
          record a new one on Lapse
        </a>
        <Button variant="ghost" size="sm" onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      {load.items.length === 0 ? (
        <div
          className="sketch rounded-2xl bg-white px-6 py-9 text-center"
          style={{ "--sk-radius": "18px" } as React.CSSProperties}
        >
          <p className="font-bold text-navy">No published timelapses yet</p>
          <p className="mx-auto mt-1.5 max-w-[42ch] text-[0.85rem] leading-snug text-navy-soft">
            Record your session on Lapse, publish it as public or unlisted, then hit refresh.
          </p>
        </div>
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {load.items.map((t) => {
            const selected = pickedIds.has(t.id);
            const blocked = !selected && (t.processing || t.attached || t.visibility === "FAILED_PROCESSING");
            const why = t.attached
              ? "already added to project"
              : t.visibility === "FAILED_PROCESSING"
                ? "failed processing on Lapse"
                : t.processing
                  ? "still processing on Lapse"
                  : null;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onToggle(t)}
                  disabled={blocked}
                  aria-pressed={selected}
                  className={cx(
                    "sketch group flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-[background-color,transform] duration-150",
                    selected ? "bg-violet-pale" : "bg-white hover:bg-cream",
                    blocked ? "cursor-not-allowed opacity-60" : "active:translate-y-px",
                  )}
                  style={
                    {
                      "--sk-color": selected ? "var(--color-violet)" : undefined,
                      "--sk-radius": "16px",
                    } as React.CSSProperties
                  }
                >
                  <span className="relative grid aspect-video w-24 shrink-0 place-items-center overflow-hidden rounded-lg bg-navy/10">
                    {t.thumbnailUrl ? (
                      // Lapse's CDN, sized by the box; next/image would need
                      // every Lapse host allow-listed for no gain at 96px.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <IconFilm className="text-lg text-navy-soft" />
                    )}
                    {selected && (
                      <span className="absolute inset-0 grid place-items-center bg-violet/70 text-white">
                        <IconCheck className="text-xl" strokeWidth={3.4} />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9rem] font-bold text-navy">
                      {t.title || "Untitled timelapse"}
                    </span>
                    <span className="hand mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.78rem] text-navy-soft tabular-nums">
                      <span className="inline-flex items-center gap-1 text-teal-deep">
                        <IconClock className="text-xs" /> {fmtDuration(t.durationSeconds)}
                      </span>
                      <span>{new Date(t.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                      {t.visibility === "UNLISTED" && <span>unlisted</span>}
                    </span>
                    {why ? (
                      <span className="hand mt-0.5 block text-[0.74rem] text-coral-deep">{why}</span>
                    ) : t.hackatimeProject ? (
                      <Chip tone="muted" className="mt-1 max-w-full truncate">
                        {t.hackatimeProject}
                      </Chip>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {load.nextCursor && (
        <div className="mt-3 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={more}>
            {more ? "Loading…" : "Show older timelapses"}
          </Button>
        </div>
      )}
    </div>
  );
}
