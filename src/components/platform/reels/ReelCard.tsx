"use client";

import { useRef, useState } from "react";
import { FoxMark } from "@/components/platform/art";
import { IconComment, IconEye, IconFilm, IconHeart, IconPlay } from "@/components/platform/icons";
import { cx } from "@/components/platform/ui";
import type { FeedItem } from "@/lib/feed";

function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${n}`;
}

/**
 * One reel. The rail stacks these in a snap column, the Doomscroller page lays
 * them out as a wall — the sizing comes in through `className` so the artwork,
 * the counts and the gradient read identically in both.
 *
 * Nothing autoplays. A column of videos all playing at once is how a feed
 * burns a phone's battery and a hotel's wifi, and the play control is also what
 * tells the server the reel was actually watched.
 */
export function ReelCard({
  reel,
  className,
  onPatch,
}: {
  reel: FeedItem;
  className?: string;
  /** Apply a change to this row after the server has taken it. */
  onPatch?: (id: string, next: Partial<FeedItem>) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const counted = useRef(false);

  const announcement = reel.pinned || reel.kind === "ANNOUNCEMENT";

  async function play() {
    if (!reel.videoUrl) return;
    const el = video.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    await el.play().catch(() => undefined);
    setPlaying(true);

    // A view is counted once per card, and the server counts it once per person
    // by unique row — so neither a replay nor a retried request can inflate it.
    if (!counted.current) {
      counted.current = true;
      void fetch(`/api/posts/${reel.id}/view`, { method: "POST" });
    }
  }

  function like() {
    const next = !reel.likedByMe;
    // Optimistic, then corrected: the count the server returns is the truth,
    // because someone else may have liked it in the meantime.
    onPatch?.(reel.id, {
      likedByMe: next,
      likeCount: reel.likeCount + (next ? 1 : -1),
    });
    // PUT, not POST: a like is idempotent — the body says which state you want,
    // not "add one" — and the route is declared that way. Sending POST got a
    // silent 405 and left the optimistic count standing until the next refresh.
    void fetch(`/api/posts/${reel.id}/like`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ liked: next }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const payload = (await res.json()) as { likeCount?: number };
        if (typeof payload.likeCount === "number") {
          onPatch?.(reel.id, { likeCount: payload.likeCount });
        }
      })
      .catch(() => undefined);
  }

  return (
    <article className={cx("relative w-full overflow-hidden rounded-xl", className)}>
      {/* Nothing generates thumbnails yet, so most reels have no poster, and
          with `preload="none"` that left a blank box with a play button on
          it. Without a poster the card fetches only the metadata and asks for
          the frame at 0.1s — the clip's own first frame, for a few kilobytes,
          rather than the whole video for every card in the feed. */}
      {reel.videoUrl ? (
        <video
          ref={video}
          src={reel.thumbnailUrl ? reel.videoUrl : `${reel.videoUrl}#t=0.1`}
          poster={reel.thumbnailUrl ?? undefined}
          playsInline
          loop
          preload={reel.thumbnailUrl ? "none" : "metadata"}
          onEnded={() => setPlaying(false)}
          className="absolute inset-0 size-full bg-navy object-cover"
        />
      ) : (
        // No URL is a deployment without a public bucket URL, not a reel
        // without a video. Saying so beats standing an illustration in for
        // somebody's footage.
        <div className="absolute inset-0 grid place-items-center bg-navy px-6 text-center">
          <p className="flex flex-col items-center gap-2 text-[0.8rem] leading-snug text-white/80">
            <IconFilm className="text-2xl text-white" />
            This video is not available right now.
          </p>
        </div>
      )}

      {announcement ? (
        <span className="label absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-2xl bg-coral px-2.5 py-1 text-white">
          <FoxMark className="size-3.5" sticker={false} face="#ffffff" />
          From HQ
        </span>
      ) : (
        <span className="label absolute top-3 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-2xl bg-black/45 px-2.5 py-1 leading-[1.2] text-white backdrop-blur-sm">
          {reel.project?.title || reel.project?.theme || "Half Life"}
        </span>
      )}

      <button
        type="button"
        onClick={() => void play()}
        disabled={!reel.videoUrl}
        aria-label={
          reel.videoUrl
            ? `${playing ? "Pause" : "Play"} reel by ${reel.author.name ?? "a maker"}`
            : "This reel is still processing"
        }
        className={cx(
          "absolute inset-0 z-10 grid place-items-center text-white/85 transition-transform duration-200",
          reel.videoUrl && "hover:scale-105",
          playing && "opacity-0 focus-visible:opacity-100",
        )}
      >
        {!playing && (
          <span className="grid size-14 place-items-center rounded-full bg-black/35 backdrop-blur-sm">
            <IconPlay className="ml-1 text-2xl" />
          </span>
        )}
      </button>

      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3.5 pt-10 pb-3.5">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[0.86rem] leading-tight font-extrabold text-white">
              {reel.author.name ?? "A maker"}
            </p>
            <p className="mt-1 line-clamp-3 text-[0.78rem] leading-snug text-white/85">
              {reel.caption}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-2.5 pb-0.5">
            <button
              type="button"
              onClick={like}
              aria-pressed={reel.likedByMe}
              aria-label={reel.likedByMe ? "Unlike" : "Like"}
              className="flex flex-col items-center gap-0.5 text-white transition-transform duration-150 hover:scale-110"
            >
              <IconHeart
                className={cx("text-[1.35rem]", reel.likedByMe && "text-coral")}
                fill={reel.likedByMe ? "currentColor" : "none"}
              />
              <span className="hand text-[0.72rem] font-semibold tabular-nums [text-shadow:0_1px_3px_rgba(0,0,0,.6)]">
                {compact(reel.likeCount)}
              </span>
            </button>
            <span className="flex flex-col items-center gap-0.5 text-white">
              <IconComment className="text-[1.3rem]" />
              <span className="hand text-[0.72rem] font-semibold tabular-nums [text-shadow:0_1px_3px_rgba(0,0,0,.6)]">
                {compact(reel.commentCount)}
              </span>
            </span>
            <span className="flex flex-col items-center gap-0.5 text-white">
              <IconEye className="text-[1.3rem]" />
              <span className="hand text-[0.72rem] font-semibold tabular-nums [text-shadow:0_1px_3px_rgba(0,0,0,.6)]">
                {compact(reel.viewCount)}
              </span>
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
