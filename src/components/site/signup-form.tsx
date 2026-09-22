"use client";

import Image from "next/image";

import brushstroke from "../../../public/art/brushstroke.png";
import { BRAND } from "@/lib/site/content";
import { SWASH_INSET_X, SWASH_INSET_Y } from "@/lib/site/stage";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

type Status = "idle" | "pending" | "done" | "error";

/**
 * The confirmation is a part passing down the line, not a terminus: it wipes
 * in over the field, holds long enough to read its ~10 words, then clears off
 * to the right and hands the empty field back. Signing up a second address is
 * the common case here — one student, a friend, a sibling — so the form must
 * never be spent.
 */
const CONFIRM_HOLD_MS = 3000;
const CONFIRM_EXIT_MS = 220;

/**
 * Email capture. Sizing is entirely `em`-relative, so the caller sets one
 * font-size and the field, the button and the paddings all follow — the comp
 * stage passes a `cqw` value, the stacked mobile layout passes a `clamp()`.
 *
 * The check is the exported comp vector (Figma 275:208), path data verbatim.
 * It is the confirmation's tick only; the submit control carries its own
 * label.
 */
export default function SignupForm({
  className = "",
  fontSize,
  style,
  intro,
}: {
  className?: string;
  fontSize?: string;
  style?: CSSProperties;
  /**
   * Anything that belongs inside the field's own box — in practice the hero's
   * tagline.
   *
   * It is a slot here rather than a sibling in the hero because of where the
   * box has to stop. The line under the field is the eligibility note, and it
   * has to stay outside: it is a footnote about who may sign up, not part of
   * the offer, and boxing it with the promise would read as fine print on a
   * coupon. The note lives in this component, so the only way to draw a box
   * around the caption and the field but not around it is for the box to be
   * drawn in here too.
   */
  intro?: ReactNode;
}) {
  const id = useId();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const holdRef = useRef<number | null>(null);
  const exitRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (holdRef.current !== null) window.clearTimeout(holdRef.current);
    if (exitRef.current !== null) window.clearTimeout(exitRef.current);
    holdRef.current = null;
    exitRef.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  /**
   * Prefill from the address bar: `?email=someone@example.com`. A link sent
   * out with the address already in it lands on a field that is filled in and
   * one click from done, which is the whole point of sending it that way.
   *
   * Read off `window.location` in an effect rather than through
   * `useSearchParams`, for the same reason the submit handler reads it that
   * way: the hook would pull this component — and so the hero above it — out
   * of the prerender and behind a Suspense boundary, to save a value that
   * only matters once the field is interactive anyway. The input is
   * uncontrolled, so writing straight onto the node after mount costs no
   * render and cannot mismatch hydration.
   *
   * It never overwrites: if someone has already typed, or the browser has
   * restored a value on a back-navigation, what is in the field wins.
   */
  useEffect(() => {
    const prefill = new URLSearchParams(window.location.search)
      .get("email")
      ?.trim();
    if (prefill && inputRef.current && !inputRef.current.value) {
      inputRef.current.value = prefill;
    }
  }, []);

  /** Wipes the plate off to the right and re-arms the field behind it. */
  const dismiss = useCallback(() => {
    clearTimers();
    setLeaving(true);
    exitRef.current = window.setTimeout(() => {
      setLeaving(false);
      setStatus("idle");
      setMessage("");
    }, CONFIRM_EXIT_MS);
  }, [clearTimers]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A second submit supersedes a confirmation still on screen: the user
    // acted, so the new state replaces the old one outright rather than
    // playing an exit nobody is waiting for.
    clearTimers();
    setLeaving(false);
    setReferralLink(null);
    setCopied(false);
    const email = inputRef.current?.value.trim() ?? "";

    if (!email) {
      setStatus("error");
      setMessage("Enter your email so we can send you the details.");
      inputRef.current?.focus();
      return;
    }

    setStatus("pending");
    setMessage("");

    // Whoever sent this visitor here — a referral link or a campaign URL —
    // is only present in this page's own address bar, so it's read fresh at
    // submit time rather than threaded in from anywhere else.
    const params = new URLSearchParams(window.location.search);

    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          ref: params.get("ref") || undefined,
          utmSource: params.get("utm_source") || undefined,
          utmMedium: params.get("utm_medium") || undefined,
          utmCampaign: params.get("utm_campaign") || undefined,
        }),
      });
      const payload: {
        ok?: boolean;
        error?: string;
        referralCode?: string;
      } = await response.json().catch(() => ({}));

      if (!response.ok || !payload.ok) {
        setStatus("error");
        setMessage(
          payload.error ??
            "That didn't go through. Give it another try in a moment.",
        );
        inputRef.current?.focus();
        return;
      }

      setStatus("done");
      setMessage(
        "You're signed up! Copy your referral link to get friends building!",
      );
      if (payload.referralCode) {
        const url = new URL(window.location.href);
        url.search = `?ref=${payload.referralCode}`;
        setReferralLink(url.toString());
      }
      if (inputRef.current) inputRef.current.value = "";
      holdRef.current = window.setTimeout(dismiss, CONFIRM_HOLD_MS);
    } catch {
      setStatus("error");
      setMessage("You look offline. Reconnect and try again.");
      inputRef.current?.focus();
    }
  }

  async function copyReferralLink() {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied or unavailable — the link is still
      // visible and selectable, so this is a silent no-op rather than an
      // error state.
    }
  }

  const pending = status === "pending";
  const confirming = status === "done";

  return (
    <div className={className} style={{ ...style, fontSize }}>
      {/* The box: the promise and the field it is asking you to fill, grouped,
          with the eligibility note left outside it below.

          Its ground is the painted swash rather than flat ink. The tagline is
          paper and reads 6.95:1 on it at the worst pixel the painting can put
          behind it, against the 3.50:1 it had bare on the hero plate, so the
          box is still the better ground for the line — and the field's own
          cyan edge reads 7.45:1 here where on ink it had 3.71:1, so the one
          boundary that had to be argued for is now the easy part.

          The padding was `pt-[1rem] pb-[1rem] p-[2rem]`, three utilities for one
          box, and the `p` lost: Tailwind emits it ahead of the two axis rules,
          so 2rem was only ever the horizontal value and the vertical 1rem was
          doing the work. It is one declaration now, and both numbers are
          derived — see `SWASH_INSET_X`.

          `isolate` keeps the swash's negative index inside this box instead of
          letting it escape to the nearest stacking context and paint behind
          the hero plate, which is to say behind nothing. */}
      <div
        className={intro ? "relative isolate mb-[1rem]" : ""}
        style={
          intro
            ? {
                paddingInline: `${SWASH_INSET_X * 100}%`,
                paddingBlock: SWASH_INSET_Y,
              }
            : undefined
        }
      >
        {intro ? (
          <>
            {/* Decorative: the promise is the sentence over it, and a brush
                mark carries nothing a reader needs. Through `next/image` rather
                than as a CSS `background-image` so the 487 KB PNG is served
                resized and re-encoded on the hero, where it would otherwise
                land whole in the middle of the largest paint on the page.

                `object-fill` is the deliberate one: `cover` would crop the ends
                that are the only thing distinguishing this from a rectangle,
                `contain` would letterbox them, and the interior is flat colour,
                so stretching it to a box that runs 6.8:1 in the stage and 3:1
                on a phone costs nothing but the angle of the two tapers. */}
            <Image
              src={brushstroke}
              alt=""
              aria-hidden
              fill
              sizes="(min-width: 1180px) 1110px, 100vw"
              quality={90}
              className="-z-10 object-fill"
            />
            {/* The 0.7em that separates the promise from the field. It was
                `mb-[0.7em]` and generated no rule at all, so the two were flush:
                the sentence sat directly on the slot it is asking you to
                fill. */}
            <div style={{ marginBottom: "0.7em" }}>{intro}</div>
          </>
        ) : null}

        {/* The row is the positioning context for the confirmation plate, so
            the plate is exactly the field's footprint and nothing below it ever
            moves. overflow-hidden keeps the wipe's cut edge crisp. */}
        <div className="relative overflow-hidden">
          <form onSubmit={onSubmit} noValidate className="flex w-full">
            <label htmlFor={id} className="sr-only">
              email address
            </label>
            {/* The field is a slot cut into the hero plate, not a control
                sitting on it: ink ground, one soft cyan edge, and an input that
                carries no surface of its own — no background, no border, no ring
                of its own, because the slot is the control. The cyan caret is
                the only accent, and it is only there while someone is typing.

                It briefly also carried the image slot's registration ticks, its
                measured grid and an uppercase legend. At 33px tall none of that
                resolved: the grid ran three cells deep and the ticks were 8px
                specks, so it read as detail for its own sake rather than as an
                instrument. One surface, one boundary, one accent does the job
                the five of them were failing to. */}
            <div
              className={`hl-field relative min-w-0 flex-1 bg-hl-ink ${
                pending ? "opacity-70" : ""
              }`}
              style={{ height: "2.1667em" }}
            >
              <input
                ref={inputRef}
                id={id}
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                disabled={pending}
                placeholder="email address"
                // Always described by the line below: the eligibility note when
                // there is nothing wrong, the error when there is. Pointing at
                // it only on error meant the note was on screen but not in the
                // accessibility tree.
                aria-describedby={`${id}-msg`}
                aria-invalid={status === "error" || undefined}
                onFocus={() => {
                  // Reaching the field is the clearest signal the confirmation has
                  // been read; clear the plate ahead of its own timer.
                  if (confirming && !leaving) dismiss();
                }}
                onChange={() => {
                  if (confirming && !leaving) dismiss();
                  if (status === "error") {
                    setStatus("idle");
                    setMessage("");
                  }
                }}
                // Display face, not the body one it inherited. The control is
                // one object — a slot cut into the plate and the word beside it
                // — and "sign up!" is set in the display face, so the field's
                // own type belongs to the same voice. Set on the input rather
                // than scoped to `::placeholder`, so the address someone types
                // does not change face out from under them mid-word.
                className="h-full w-full bg-transparent px-[0.667em] font-display text-hl-paper caret-hl-cyan outline-none placeholder:text-hl-paper-soft"
              />

              {/* Edge at 55% rather than the slot component's 45%: on ink that
                  is 3.71:1 where 45% is 2.96, and this boundary belongs to a
                  control rather than to a picture. */}
              <span
                aria-hidden
                className="hl-field-edge pointer-events-none absolute inset-0 border-2 border-hl-cyan"
              />
            </div>

            {/* The label, not a glyph. A check meant "done" on a control whose
                job is "start" — the one place on the page where the tick is
                honest is the confirmation that wipes over the field once the
                address is in, which is where it still lives.

                Padding rather than a fixed 2.8em width, so the button is as
                wide as its word: 5.34em, which the field gives up out of its
                own flex-1. At the narrowest phone that leaves the field 163px
                against the 125px its placeholder needs.

                Label and spinner share one grid cell, so the label reserves the
                button's width even while hidden and a submit cannot resize the
                row under the pointer. `invisible` and not `opacity-0` because
                visibility:hidden also takes the label out of the accessibility
                tree, which lets the pending name be the only one there. */}
            <button
              type="submit"
              disabled={pending}
              className="grid shrink-0 place-items-center bg-hl-cyan text-hl-ink transition-colors hover:bg-white focus-visible:bg-white disabled:cursor-progress disabled:bg-hl-blue"
              style={{ height: "2.1667em", paddingInline: "0.9em" }}
            >
              <span
                className={`[grid-area:1/1] whitespace-nowrap font-display font-bold leading-none ${
                  pending ? "invisible" : ""
                }`}
                style={{ fontSize: "0.85em" }}
              >
                sign up!
              </span>
              {pending ? (
                <>
                  <Spinner className="h-[0.9em] w-[0.9em] animate-spin [grid-area:1/1]" />
                  <span className="sr-only">Signing you up</span>
                </>
              ) : null}
            </button>
          </form>

          {/* Set at 0.75em so the full sentence holds one line on the comp stage
              and, where it wraps on a narrow phone, two lines still sit inside
              the field's own height. */}
          {confirming ? (
            <p
              aria-hidden
              className={`pointer-events-none absolute inset-0 flex items-center gap-[0.6em] bg-hl-cyan px-[0.8em] font-semibold leading-tight text-hl-ink ${
                leaving ? "hl-confirm-out" : "hl-confirm-in"
              }`}
              style={{ fontSize: "0.75em" }}
            >
              <Check draw className="h-[0.95em] w-[0.98em] shrink-0" />
              <span>{message}</span>
            </p>
          ) : null}
        </div>
      </div>

      {/* One line under the field, carrying the eligibility note until there
          is an error to carry instead. It was already reserving this height
          with a transparent space so an error could never move the plate
          above it, so the note costs no layout and the swap costs none
          either — the error takes a line that is already lit rather than
          opening a new one, and the note is what the field is described by
          the rest of the time.

          The confirmation is not repeated here: it is already on the plate,
          and a second copy at 0.6em would wrap on a phone and push the page
          around under it.

          Paper, not the soft tint the placeholder uses: this sits on the
          hero plate rather than in the field's own ink slot, and the plate is
          only 60% opaque over the painting — soft paper falls to 3.44:1
          there, where paper holds 5.28:1. Regular weight against the error's
          semibold, so the two read apart at a glance as well as by colour. */}
      <p
        id={`${id}-msg`}
        className={`mt-[0.45em] ${
          status === "error" ? "font-semibold text-hl-cyan" : "text-hl-paper"
        }`}
        style={{ fontSize: "0.6em", minHeight: "1.4em" }}
      >
        {status === "error" ? message : BRAND.eligibility}
      </p>

      {/* Persists past the confirmation plate's own dismiss timer: unlike
          the wipe-in message, this is worth keeping on screen so the link is
          still there to copy after the "you're on the list" plate is gone. */}
      {referralLink ? (
        <p className="mt-[0.3em] text-hl-paper" style={{ fontSize: "0.6em" }}>
          Refer a friend:{" "}
          <button
            type="button"
            onClick={copyReferralLink}
            className="underline decoration-hl-cyan/60 underline-offset-2 hover:text-hl-cyan"
          >
            {copied ? "Link copied!" : "Copy your referral link"}
          </button>
        </p>
      ) : null}

      {/* One persistent live region does all the announcing. The confirmation
          plate mounts with its text already in it, and a live region created
          that way is unreliably announced; this one is always in the tree, so
          every status change is a change to it. It carries no layout, which is
          what lets the visible confirmation live on the plate alone. */}
      <p role="status" aria-live="polite" className="sr-only">
        {message}
      </p>
    </div>
  );
}

function Check({
  className,
  draw = false,
}: {
  className?: string;
  /** Strokes the tick in, for the one moment the state really changes. */
  draw?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 39.4045 38.2329"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d="M1.28624 25.8278L16.2862 34.8278L37.2862 1.32784"
        stroke="currentColor"
        strokeWidth={5}
        className={draw ? "hl-stroke" : undefined}
      />
    </svg>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <circle
        cx={12}
        cy={12}
        r={9}
        stroke="currentColor"
        strokeWidth={3}
        strokeOpacity={0.3}
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="square"
      />
    </svg>
  );
}
