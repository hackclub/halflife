"use client"

import { useEffect, useRef, useState } from "react"
import { Gato } from "@/components/platform/art"
import { IconComment, IconEye, IconFilm, IconHeart, IconPlay } from "@/components/platform/icons"
import { cx } from "@/components/platform/ui"
import type { FeedItem } from "@/lib/feed"

function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${n}`
}

/**
 * How much of a card has to be on screen for it to be the current reel. With
 * every card at least the height of its column, two can never both clear this,
 * so "current" is always one card or none.
 */
const CURRENT = 0.6

/**
 * The one reel allowed to be making noise, across every feed on the page. Every
 * way into playback goes through `start`, which silences this one first, so
 * scrolling on, pressing play on another card, or the rail and the full page
 * both being mounted can never leave two soundtracks talking over each other.
 */
let playingNow: HTMLVideoElement | null = null

function start(el: HTMLVideoElement) {
  claim(el)
  // Autoplay with sound is the browser's call, not ours: without a click on the
  // page first it is refused, and the card simply keeps its play button.
  return el.play().catch(() => undefined)
}

/** Make `el` the one reel allowed to play, silencing whichever was. */
function claim(el: HTMLVideoElement) {
  if (playingNow && playingNow !== el) playingNow.pause()
  playingNow = el
}

/**
 * Play `el` as the only reel making noise, for players with their own
 * controls (the full-page stage). Resolves to whether it is playing — false
 * when the browser refused, which is the caller's cue to retry muted.
 */
export function playExclusive(el: HTMLVideoElement): Promise<boolean> {
  claim(el)
  return el.play().then(
    () => true,
    () => false,
  )
}

/** For a video that started some other way — the element's own play event. */
export function notePlaying(el: HTMLVideoElement) {
  claim(el)
}

export function noteStopped(el: HTMLVideoElement) {
  if (playingNow === el) playingNow = null
}

/** Silence whichever reel is playing, for a feed that is being put away. */
export function pauseReels() {
  playingNow?.pause()
}

/**
 * Like or unlike a reel: optimistic, then corrected. The count the server
 * returns is the truth, because someone else may have liked it meanwhile.
 *
 * PUT, not POST: a like is idempotent — the body says which state you want,
 * not "add one" — and the route is declared that way. Sending POST got a
 * silent 405 and left the optimistic count standing until the next refresh.
 */
export function sendLike(reel: FeedItem, next: boolean, onPatch?: (id: string, patch: Partial<FeedItem>) => void) {
  if (reel.likedByMe === next) return
  onPatch?.(reel.id, { likedByMe: next, likeCount: reel.likeCount + (next ? 1 : -1) })
  void fetch(`/api/posts/${reel.id}/like`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ liked: next }),
  })
    .then(async (res) => {
      if (!res.ok) {
        // Refused: put it back as it was.
        onPatch?.(reel.id, { likedByMe: reel.likedByMe, likeCount: reel.likeCount })
        return
      }
      const payload = (await res.json()) as { likeCount?: number }
      if (typeof payload.likeCount === "number") onPatch?.(reel.id, { likeCount: payload.likeCount })
    })
    .catch(() => onPatch?.(reel.id, { likedByMe: reel.likedByMe, likeCount: reel.likeCount }))
}

function prefersStill() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * The reel that has just taken the frame says so: its author, caption and
 * counts rise into place a beat behind the video, the way a feed hands over
 * from one clip to the next. Played by the Web Animations API rather than a
 * class, because it has to restart on every arrival and a card scrolled back
 * to is arriving again. It only ever animates FROM hidden: the resting state
 * is fully visible, so a browser that never runs it shows everything.
 */
const ARRIVE: Keyframe[] = [
  { opacity: 0, transform: "translateY(12px)" },
  { opacity: 1, transform: "none" },
]
const ARRIVE_TIMING: KeyframeAnimationOptions = {
  duration: 420,
  delay: 90,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
  fill: "backwards",
}

/**
 * One reel. The rail stacks these in a snap column, the Doomscroller page lays
 * them out as a wall — the sizing comes in through `className` so the artwork,
 * the counts and the gradient read identically in both.
 *
 * Only the current reel plays. A card pauses the moment it scrolls out of the
 * current slot, and with `autoplay` the card that takes the slot starts on its
 * own — one video at a time, never a column of them burning a phone's battery
 * and a hotel's wifi. Anyone who has asked for less motion gets the pausing but
 * not the starting.
 */
export function ReelCard({
  reel,
  className,
  onPatch,
  autoplay = false,
  onPlayPress,
}: {
  reel: FeedItem
  className?: string
  /** Apply a change to this row after the server has taken it. */
  onPatch?: (id: string, next: Partial<FeedItem>) => void
  /** Start playing when this card becomes the current reel. */
  autoplay?: boolean
  /** The reader pressed play themselves. */
  onPlayPress?: () => void
}) {
  const card = useRef<HTMLElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const meta = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const counted = useRef(false)
  // Whether this card holds the current slot. Playback is only ever changed as
  // a card enters or leaves it, never while it stays there — so a reel the
  // reader paused stays paused until they scroll away and back.
  const current = useRef(false)
  // Read by the observer at the moment a card arrives, so a feed switching
  // autoplay on does not tear the observer down (and pause the video) to do it.
  const wantsAutoplay = useRef(autoplay)

  const announcement = reel.pinned || reel.kind === "ANNOUNCEMENT"

  useEffect(() => {
    wantsAutoplay.current = autoplay
  }, [autoplay])

  // Rooted on the viewport rather than the feed's own scroller: the rail is
  // closed by collapsing and clipping the panels AROUND that scroller, which an
  // observer rooted inside it never sees. Measured against the viewport, a
  // closing rail, a rail hidden at narrow widths and a reel scrolled past all
  // read the same way — the card is no longer on screen, so it stops.
  useEffect(() => {
    const box = card.current
    const el = video.current
    if (!box || !el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        const now = !!entry?.isIntersecting && entry.intersectionRatio >= CURRENT
        if (now === current.current) return
        current.current = now
        if (!now) {
          el.pause()
          return
        }
        // Only in a feed being watched. The rail sits idle beside every page,
        // and replaying an arrival on each navigation would be motion for its
        // own sake.
        if (!wantsAutoplay.current || prefersStill()) return
        meta.current?.animate?.(ARRIVE, ARRIVE_TIMING)
        void start(el)
      },
      { threshold: CURRENT },
    )
    io.observe(box)
    return () => {
      io.disconnect()
      current.current = false
      el.pause()
    }
  }, [reel.videoUrl])

  function toggle() {
    const el = video.current
    if (!reel.videoUrl || !el) return
    if (!el.paused) {
      el.pause()
      return
    }
    onPlayPress?.()
    void start(el)
  }

  // A view is a second of actual playback, not a press or an autoplay that a
  // quick flick scrolled straight past. It is counted once per card, and the
  // server counts it once per person by unique row — so neither a replay nor a
  // retried request can inflate it.
  function countView() {
    const el = video.current
    if (counted.current || !el) return
    let watched = 0
    for (let i = 0; i < el.played.length; i++) watched += el.played.end(i) - el.played.start(i)
    if (watched < 1) return
    counted.current = true
    void fetch(`/api/posts/${reel.id}/view`, { method: "POST" })
  }

  function like() {
    sendLike(reel, !reel.likedByMe, onPatch)
  }

  return (
    <article ref={card} className={cx("relative w-full overflow-hidden rounded-xl", className)}>
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
          // The element is the truth about whether it is playing: it can be
          // paused by the observer, by another card starting, or by the browser
          // refusing autoplay, none of which pass through the button.
          onPlay={(e) => {
            notePlaying(e.currentTarget)
            setPlaying(true)
          }}
          onPause={(e) => {
            noteStopped(e.currentTarget)
            setPlaying(false)
          }}
          onTimeUpdate={countView}
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
          <Gato sizes="28px" className="h-auto w-4" />
          From HQ
        </span>
      ) : (
        <span className="label absolute top-3 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-2xl bg-black/45 px-2.5 py-1 leading-[1.2] text-white backdrop-blur-sm">
          {reel.project?.title || reel.project?.theme || "Half Life"}
        </span>
      )}

      <button
        type="button"
        onClick={toggle}
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
        <div ref={meta} className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[0.86rem] leading-tight font-extrabold text-white">{reel.author.name ?? "A maker"}</p>
            <p className="mt-1 line-clamp-3 text-[0.78rem] leading-snug text-white/85">{reel.caption}</p>
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
  )
}
