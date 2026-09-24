"use client";

import { Fragment, useEffect, useRef } from "react";
import { PrinterArt, WeekScene } from "@/components/platform/art";
import {
  IconCheck,
  IconChevronsUp,
  IconClock,
  IconFilm,
  IconLock,
  IconPencil,
  IconPlay,
  IconSparkle,
  IconUpload,
} from "@/components/platform/icons";
import { Chip, Panel, cx } from "@/components/platform/ui";
import { printerById } from "@/lib/config/printers";
import { useStore } from "@/lib/store";
import type { Checkpoint, Week } from "@/lib/types";

/** Horizontal swing of the trail, as a percentage of the column width. */
const AMP = 23;
const CURVE = 1.02;

const offsetAt = (i: number) => Number((50 + AMP * Math.sin(i * CURVE)).toFixed(4));

const KIND_ICON = {
  onboarding: IconSparkle,
  project: IconPencil,
  journal: IconClock,
  reel: IconFilm,
  submit: IconUpload,
  demo: IconPlay,
} as const;

/**
 * A journal entry is a smaller beat than a milestone, and a long week is mostly
 * entries — so they get a smaller puck and a shorter stride. Big node, run of
 * small ones, big node: the week reads as rhythm instead of as a queue.
 */
const isBeat = (c: Checkpoint) => c.kind === "journal" && !c.branch;

/** Where a node sits, counting the strides taken to reach it. */
const offsetOf = (full: number, beats: number, extra = "") =>
  `calc(var(--lead) + var(--step) * ${full} + var(--step-sm) * ${beats}${extra})`;

/** Hours, two decimals at most and never a trailing zero. */
const fmtH = (h: number) => `${Math.round(h * 100) / 100}h`;

/**
 * Checkpoints that bring something into existence rather than record it. Going
 * through onboarding or the project form a second time would mint a second
 * project for a week that already has one, and every lookup in the app finds a
 * week's project with `.find` — so the duplicate would not replace the first,
 * it would sit behind it, unreachable and counting for nothing.
 */
const ONE_TIME: Checkpoint["kind"][] = ["onboarding", "project"];

function nodeTone(kind: Checkpoint["kind"], done: boolean, unlocked: boolean, passed: boolean) {
  if (passed) return "puck-passed";
  if (!unlocked) return "puck-locked";
  // The onboarding puck keeps its gold once it is finished. It is the landmark
  // for where the trail started; the check is what says it is done.
  if (kind === "onboarding") return "puck-gold";
  if (done) return "puck-done";
  if (kind === "submit" || kind === "demo") return "puck-gate";
  return "";
}

function CheckpointNode({
  checkpoint,
  top,
  left,
  isCurrent,
  choice = false,
}: {
  checkpoint: Checkpoint;
  top: string;
  left: string;
  isCurrent: boolean;
  /** One half of a fork: both arms are live, and neither is the recommendation. */
  choice?: boolean;
}) {
  const { stateOf, isUnlocked, isPassed, lockReason, setOpenCheckpoint, phase, weekSubmitted, phaseStatusOf } =
    useStore();
  const st = stateOf(checkpoint.id);
  const unlocked = isUnlocked(checkpoint.id);
  // Its week ran out of time. Done or not, it is the record now: no redo, no
  // more entries, and the tooltip says only that.
  const passed = isPassed(checkpoint.id);
  // Done and not for doing again. It keeps its finished colours rather than
  // taking the locked ones: this is a thing achieved, not a thing withheld.
  // A finished entry opens for editing — until its week is handed in, when
  // the entries are what the review reads and they stop changing.
  const final = st.done && checkpoint.kind === "journal" && weekSubmitted(checkpoint.weekId);
  // A handed-in week's Submit opens to unsubmit it while it waits for review,
  // and to hand it in again once it is sent back. Decided, there is nothing
  // left to do from it, so it stops opening.
  const handIn = checkpoint.kind === "submit" || checkpoint.kind === "demo";
  const reviewStatus = handIn && st.done ? phaseStatusOf(checkpoint.weekId) : null;
  const decided = reviewStatus === "approved" || reviewStatus === "rejected";
  const settled = (st.done && ONE_TIME.includes(checkpoint.kind)) || final || decided;
  const doneNote =
    checkpoint.kind === "reel"
      ? "click to post another reel."
      : checkpoint.kind === "journal"
        ? final
          ? "this week is submitted, so the entry is final."
          : "click to edit your entry."
        : reviewStatus === "in_review"
          ? "waiting for review. click to unsubmit it."
          : reviewStatus === "update_requested"
            ? "sent back for changes. click to hand it in again."
            : reviewStatus === "approved"
              ? "approved — this week is done."
              : reviewStatus === "rejected"
                ? "this week has been reviewed."
                : null;
  const locked = !unlocked ? lockReason(checkpoint.id) : null;
  // Finished and still reachable: hovering says so, and says what a click
  // does now — edit the entry, or post another reel.
  const doneTip = st.done && unlocked && !passed;
  const Icon = st.done ? IconCheck : unlocked ? KIND_ICON[checkpoint.kind] : IconLock;
  // Gold stays gold after completion, so the icon on it has to stay navy.
  const gold = checkpoint.kind === "onboarding";

  const status = st.done ? "Completed" : unlocked ? "Available" : "Locked";

  return (
    <div
      data-cp={checkpoint.id}
      // No z-index: the week banner is a sticky header and has to win. Nodes
      // paint in DOM order, which already puts each callout over the node
      // above it, and --lead keeps the first one clear of the banner.
      className={cx(
        "group absolute flex flex-col items-center",
        isBeat(checkpoint) ? "w-[var(--node-sm)]" : "w-[var(--node)]",
      )}
      style={{ top, left, transform: "translateX(-50%)" }}
    >
      {isCurrent && !choice && phase !== "aim" && (
        <div
          data-callout=""
          className="pointer-events-none absolute bottom-[calc(100%_+_10px)] z-20 w-max max-w-[min(11rem,38vw)]"
        >
          <div
            className={cx(
              "sketch relative rounded-2xl px-3.5 py-2 text-center motion-safe:animate-[hl-bob_2.4s_ease-in-out_infinite]",
              gold ? "bg-gold text-navy" : "bg-navy text-white",
            )}
            style={
              {
                "--sk-color": gold ? "var(--color-gold-deep)" : "var(--color-navy)",
                "--sk-radius": "14px",
              } as React.CSSProperties
            }
          >
            <p className="label whitespace-nowrap">{st.done ? "Redo" : "Start here"}</p>
            <p className="mt-0.5 text-[0.74rem] leading-tight font-semibold opacity-85">
              {checkpoint.title}
            </p>
            <span
              aria-hidden="true"
              className={cx(
                "absolute top-full left-1/2 -ml-2 size-0 border-x-8 border-t-[9px] border-x-transparent",
                gold ? "border-t-gold" : "border-t-navy",
              )}
            />
          </div>
        </div>
      )}

      {/* Why this one is shut. It hangs where the "Start here" callout hangs,
          in sand rather than navy — the trail already uses that shape to speak
          about a node, and a locked node is the other half of the same
          sentence. The two never appear together: a locked checkpoint is never
          the current one. */}
      {locked && (
        <div className="pointer-events-none absolute bottom-[calc(100%_+_10px)] z-20 w-max max-w-[min(13rem,42vw)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <div
            className="sketch rounded-2xl bg-sand px-3.5 py-2.5 text-left"
            style={
              {
                "--sk-color": "var(--color-sand-deep)",
                "--sk-radius": "14px",
              } as React.CSSProperties
            }
          >
            {passed ? (
              <p className="text-[0.78rem] leading-snug font-semibold whitespace-nowrap text-navy">
                {locked}
              </p>
            ) : (
              <>
                <p className="text-[0.74rem] leading-snug font-semibold text-navy">
                  {checkpoint.blurb}
                </p>
                <p className="hand mt-1.5 flex items-start gap-1.5 text-[0.72rem] leading-snug text-navy-soft">
                  <IconLock className="mt-px shrink-0 text-[0.8rem]" />
                  {locked}
                </p>
              </>
            )}
            <span
              aria-hidden="true"
              className="absolute top-full left-1/2 -ml-2 size-0 border-x-8 border-t-[9px] border-x-transparent border-t-sand"
            />
          </div>
        </div>
      )}

      {/* The same bubble in the done colours: mint and teal, a check where the
          lock would be. A finished entry adds what clicking it does now. */}
      {doneTip && (
        <div className="pointer-events-none absolute bottom-[calc(100%_+_10px)] z-20 w-max max-w-[min(13rem,42vw)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <div
            className="sketch rounded-2xl bg-mint px-3.5 py-2.5 text-left"
            style={
              {
                "--sk-color": "var(--color-teal-deep)",
                "--sk-radius": "14px",
              } as React.CSSProperties
            }
          >
            <p className="flex items-start gap-1.5 text-[0.74rem] leading-snug font-semibold text-navy">
              <IconCheck className="mt-px shrink-0 text-[0.8rem] text-teal-deep" strokeWidth={3} />
              You&apos;ve already completed this checkpoint!
            </p>
            {doneNote && (
              <p className="hand mt-1 pl-5 text-[0.72rem] leading-snug text-navy-soft">{doneNote}</p>
            )}
            <span
              aria-hidden="true"
              className="absolute top-full left-1/2 -ml-2 size-0 border-x-8 border-t-[9px] border-x-transparent border-t-mint"
            />
          </div>
        </div>
      )}

      <button
        type="button"
        data-tour={checkpoint.kind === "onboarding" ? "first-checkpoint" : undefined}
        disabled={!unlocked || settled}
        onClick={() => setOpenCheckpoint(checkpoint.id)}
        aria-label={
          locked
            ? `${checkpoint.title} — ${status}. ${locked}`
            : doneTip && doneNote
              ? `${checkpoint.title} — ${status}. ${doneNote.charAt(0).toUpperCase()}${doneNote.slice(1)}`
              : `${checkpoint.title} — ${status}`
        }
        className={cx(
          "puck",
          nodeTone(checkpoint.kind, st.done, unlocked, passed),
          // The puck's own disabled rule reads as refusal. A finished
          // checkpoint is not refusing anything.
          settled && "cursor-default",
        )}
      >
        {(isCurrent || choice) && (
          <span aria-hidden="true" className={cx("halo", gold && "halo-gold")} />
        )}
        <span className="puck-face">
          <Icon
            className={cx(
              isBeat(checkpoint)
                ? "text-[clamp(0.95rem,2.8vw,1.25rem)]"
                : "text-[clamp(1.5rem,4.4vw,2rem)]",
              passed ? "text-white" : !unlocked ? "text-sand-deep" : gold ? "text-navy" : "text-white",
            )}
            strokeWidth={st.done ? 3 : 2}
          />
        </span>
      </button>

      <p
        className={cx(
          "hand mt-2 text-center leading-tight",
          isBeat(checkpoint) ? "text-[0.64rem]" : "text-[0.72rem]",
          unlocked ? "text-navy" : "text-navy-soft/70",
        )}
      >
        {checkpoint.title}
      </p>
      {(unlocked || passed) && st.done && st.minutes > 0 && (
        <p className="hand text-[0.66rem] leading-tight text-navy-soft tabular-nums">
          {fmtH(st.minutes / 60)}
        </p>
      )}
    </div>
  );
}

function WeekBanner({ week, index }: { week: Week; index: number }) {
  const { stateOf } = useStore();
  const done = week.checkpoints.filter((c) => stateOf(c.id).done).length;

  return (
    <div data-week-banner="" className="sticky top-16 z-10 -mx-1 px-1 pt-4 pb-3">
      <div className="relative">
        <div
          aria-hidden="true"
          className="torn absolute inset-0 rounded"
          style={{
            background: week.accent,
            boxShadow: "0 3px 6px rgba(28,26,89,.12), 0 16px 34px -18px rgba(28,26,89,.5)",
          }}
        />
        <div className="relative flex items-center gap-3 px-5 py-3.5 sm:gap-5 sm:px-7 sm:py-4">
          <div className="min-w-0 flex-1">
            <p className="label text-white/85">
              Week {week.id}/10 · {week.phase === "design" ? "Design" : "Build"}
            </p>
            <h2 className="mt-0.5 truncate text-[1.25rem] leading-none font-extrabold tracking-[-0.025em] text-white sm:text-[1.75rem]">
              {week.headline}
            </h2>
            <p className="mt-1.5 hidden max-w-[52ch] text-[0.82rem] leading-snug text-white/85 sm:block">
              {week.summary}
            </p>
          </div>
          <WeekScene
            theme={week.theme}
            className="hidden h-16 w-auto shrink-0 drop-shadow-md sm:block md:h-[74px]"
          />
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="label rounded-full bg-white/25 px-2.5 py-1 text-white tabular-nums">
              {done}/{week.checkpoints.length}
            </span>
            {index === 0 && (
              <IconChevronsUp className="hidden text-lg text-white/70 sm:block" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Where the two halves of a fork sit, as a percentage of the column. */
/** A fork has exactly two arms: keep working, or wrap the week up. */
const FORK_AT: [number, number] = [24, 76];

/**
 * One week's stretch of trail. Positions are walked rather than multiplied,
 * because entries and milestones take different-sized strides — but the
 * left-right swing still comes from the node's place in the line.
 *
 * A stride is sized by the node it leaves, never by the one it arrives at.
 * That is the only version that cannot collide: what has to be cleared is the
 * height of the node behind you — its puck, its label, and the hours under a
 * finished entry — and a milestone is half as tall again as a beat. Sizing on
 * arrival instead puts a beat's short stride under a milestone's tall label,
 * and the label lands on the next puck.
 *
 * A week past its tier floor ends in a fork: two checkpoints on one row,
 * pinned left and right instead of taking the swing. The fork is always the
 * last row, which is what lets every row before it keep using its own index
 * for the sine — the trail above a fork is laid out exactly as it was.
 */
function WeekTrail({ week, currentId }: { week: Week; currentId: string | null }) {
  // Group into rows: singles all the way down, then the fork as one row of two.
  const rows: Checkpoint[][] = [];
  for (const cp of week.checkpoints) {
    const last = rows[rows.length - 1];
    if (cp.branch && last?.[0]?.branch) last.push(cp);
    else rows.push([cp]);
  }

  const placed: { row: Checkpoint[]; full: number; beats: number; beat: boolean }[] = [];
  let full = 0;
  let beats = 0;
  for (const [i, row] of rows.entries()) {
    if (i > 0) {
      // The stride belongs to the row we are stepping off, not this one.
      if (placed[i - 1]?.beat) beats += 1;
      else full += 1;
    }
    placed.push({ row, full, beats, beat: row.every(isBeat) });
  }

  const leftOf = (i: number, j: number) =>
    (placed[i]?.row.length ?? 0) > 1 ? (FORK_AT[j] ?? FORK_AT[0]) : offsetAt(i);

  const dots: React.ReactNode[] = [];
  for (let i = 0; i < placed.length - 1; i += 1) {
    const here = placed[i];
    const next = placed[i + 1];
    if (!here || !next) continue;
    const stride = here.beat ? "var(--step-sm)" : "var(--step)";
    const size = here.beat ? "var(--node-sm)" : "var(--node)";
    // Into a fork the run splits and each arm is drawn straight to its node;
    // down the chain the dots keep sampling the sine, so the curve they have
    // always traced is untouched.
    for (const [j] of next.row.entries()) {
      for (const f of [0.3, 0.5, 0.7]) {
        dots.push(
          <span
            key={`${i}-${j}-${f}`}
            aria-hidden="true"
            className="absolute size-[7px] rounded-full bg-line-strong/45"
            style={{
              top: offsetOf(here.full, here.beats, ` + ${f} * ${stride} + ${size} / 2`),
              left:
                next.row.length > 1
                  ? `${leftOf(i, 0) + ((FORK_AT[j] ?? FORK_AT[0]) - leftOf(i, 0)) * f}%`
                  : `${offsetAt(i + f)}%`,
              transform: "translate(-50%, -50%)",
            }}
          />,
        );
      }
    }
  }

  return (
    <div className="relative" style={{ height: offsetOf(full, beats, " + var(--node) + 52px") }}>
      {dots}
      {placed.map(({ row, full: f, beats: b }, i) => (
        <Fragment key={row[0]?.id ?? i}>
          {row.length > 1 && (
            <p
              aria-hidden="true"
              className="hand absolute text-[0.78rem] text-line-strong"
              style={{
                top: offsetOf(f, b, " + var(--node) / 2"),
                left: "50%",
                transform: "translate(-50%, -50%)",
              }}
            >
              or
            </p>
          )}
          {row.map((cp, j) => (
            <CheckpointNode
              key={cp.id}
              checkpoint={cp}
              top={offsetOf(f, b)}
              left={`${leftOf(i, j)}%`}
              isCurrent={cp.id === currentId}
              choice={row.length > 1}
            />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

function PhaseDivider() {
  return (
    <div className="relative my-10 flex items-center gap-4" aria-hidden="true">
      <span className="h-px flex-1 bg-line" />
      <Panel tone="teal" radius={999} className="bg-mint px-5 py-2">
        <p className="label text-teal-deep">Halfway! Now it&apos;s time to build</p>
      </Panel>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/**
 * What the whole trail is aimed at, so it shows the machine actually on the
 * wall rather than the one at the bottom of the catalogue.
 *
 * No meter under it. Coins, hours and the streak are the only running totals
 * this product keeps, and the header already carries them everywhere; a
 * fourth bar here would be a number to check rather than a thing to want.
 * The picture is the point.
 */
function GrandPrize() {
  const { goalId } = useStore();
  const goal = printerById(goalId);

  return (
    <Panel tone="gold" radius={24} className="relative mt-12 overflow-hidden bg-gold-pale px-6 py-8 sm:px-10">
      <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
        <PrinterArt kind={goal.kind} className="h-40 w-auto shrink-0 sm:h-48" />
        <div className="min-w-0">
          <Chip tone="gold">Finish all ten weeks</Chip>
          <h2 className="mt-3 text-[1.7rem] leading-tight font-extrabold tracking-[-0.03em] text-navy sm:text-[2.2rem]">
            {goal.name}
          </h2>
          <p className="mt-2 max-w-[54ch] text-[0.95rem] leading-relaxed text-navy-soft">
            Bank the coins and it is yours, shipped to your door. Miss a week and you keep
            everything you built anyway — the funding is not a loan.
          </p>
        </div>
      </div>
    </Panel>
  );
}

export function CheckpointPath() {
  const { currentCheckpointId, hydrated, phase, weeks } = useStore();
  const scrolled = useRef(false);

  useEffect(() => {
    if (!hydrated || scrolled.current || !currentCheckpointId) return;
    if (phase === "cinematic" || phase === "aim") return;
    scrolled.current = true;
    const node = document.querySelector<HTMLElement>(`[data-cp="${currentCheckpointId}"]`);
    if (!node) return;
    node.scrollIntoView({ block: "center", behavior: "auto" });

    // The week banner is sticky, so centring the node can park its callout
    // underneath it. Hand back whatever the banner took, plus a little air.
    // A node on a fork row has no callout — there the node's own top is the
    // edge that has to clear.
    const banner = node.closest("section")?.querySelector<HTMLElement>("[data-week-banner]");
    if (!banner) return;
    const lead = node.querySelector<HTMLElement>("[data-callout]") ?? node;
    const overlap = banner.getBoundingClientRect().bottom + 12 - lead.getBoundingClientRect().top;
    if (overlap > 0) window.scrollBy(0, -overlap);
  }, [hydrated, currentCheckpointId, phase]);

  return (
    <div
      className="mx-auto w-full max-w-[720px] px-4 sm:px-8"
      style={
        {
          "--node": "clamp(72px, 13.5vw, 98px)",
          "--step": "clamp(140px, 20vw, 162px)",
          /* An entry is a beat, not a milestone: smaller puck, shorter stride,
             so a twenty-entry week stays a trail instead of a corridor. */
          "--node-sm": "clamp(42px, 7.5vw, 54px)",
          "--step-sm": "clamp(100px, 13vw, 116px)",
          /* Room between a week banner and its first puck for the callout
             that hangs above the current checkpoint, bob included. */
          "--lead": "clamp(70px, 9vw, 80px)",
        } as React.CSSProperties
      }
    >
      {weeks.map((week, wi) => (
        <section key={week.id} aria-labelledby={`week-${week.id}`}>
          {wi === 5 && <PhaseDivider />}
          <h3 id={`week-${week.id}`} className="sr-only">
            Week {week.id}: {week.fullName}
          </h3>
          <WeekBanner week={week} index={wi} />
          <WeekTrail week={week} currentId={currentCheckpointId} />
        </section>
      ))}
      <GrandPrize />
    </div>
  );
}
