"use client"

import { useId, useState } from "react"
import { PrinterPhoto } from "@/components/platform/art"
import { IconCheck, IconClock, IconCoin } from "@/components/platform/icons"
import { Button, cx } from "@/components/platform/ui"
import { MAX_HOURS_PER_WEEK, PRINTERS, type PrinterGoal, printerById, weeksToGo } from "@/lib/config/printers"
import { BUILD_HOURS } from "@/lib/curriculum"
import { useStore } from "@/lib/store"
import { Modal, ModalTitle } from "./Modal"

const TEAL = "var(--color-teal-deep)"

/**
 * Picking the machine at the end of the season. Eight of them, and the only
 * honest way to compare is side by side: what it costs in coins, and how many
 * hours a week on tier 1 that price actually asks of you.
 */
export function GoalModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { goalId, setGoal, printerFund } = useStore()
  const [picked, setPicked] = useState(goalId)
  const titleId = useId()

  // Reopening should start from whatever is taped up now, including a goal that
  // changed elsewhere — adjusting during render beats an effect that repaints.
  const [seenGoal, setSeenGoal] = useState(goalId)
  if (seenGoal !== goalId) {
    setSeenGoal(goalId)
    setPicked(goalId)
  }

  const goal = printerById(picked)
  const unchanged = picked === goalId
  // Both pots pay for a printer (lib/currency), so the honest "to go" reads the
  // total; `coins` alone would tell a banked-up saver they are far behind.
  const toGo = Math.max(0, goal.coins - printerFund)
  const weeks = weeksToGo(goal, printerFund)

  function commit() {
    setGoal(picked)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      accent={TEAL}
      size="xl"
      labelledBy={titleId}
      eyebrow="Your goal"
      footer={
        <>
          <p className="mr-auto w-full text-[0.82rem] leading-snug text-navy-soft sm:w-auto sm:max-w-[44ch]">
            <span className="font-extrabold text-navy">{goal.name}</span>
            {toGo > 0 ? (
              weeks > 0 ? (
                <>
                  {" — "}
                  <span className="tabular-nums">{toGo.toLocaleString()}</span> coins to go: about{" "}
                  {goal.hoursPerWeek.toFixed(1)} hours a week for {weeks} design weeks{" "}
                </>
              ) : (
                <>
                  {" — "}
                  <span className="tabular-nums">{toGo.toLocaleString()}</span> coins to go, and the build weeks cover
                  it at {BUILD_HOURS} hours a week.{" "}
                </>
              )
            ) : (
              <> you&apos;ve reached this printer goal! </>
            )}
            <a
              href={goal.link}
              target="_blank"
              rel="noreferrer"
              className="font-semibold whitespace-nowrap text-sky-ink underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
            >
              Link to printer
            </a>
          </p>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="teal" onClick={commit}>
            {unchanged ? "Keep this goal" : "Set this goal"} <IconCheck className="text-base" />
          </Button>
        </>
      }
    >
      <ModalTitle
        id={titleId}
        subWide
        sub="Spend more time on your hardware projects to unlock better printers! You can change this goal anytime you'd like."
      >
        What&apos;s your big prize?
      </ModalTitle>

      <div role="radiogroup" aria-labelledby={titleId} className="grid gap-x-4 gap-y-6 sm:grid-cols-2">
        {PRINTERS.map((p) => (
          <GoalCard
            key={p.id}
            goal={p}
            current={p.id === goalId}
            selected={p.id === picked}
            onSelect={() => setPicked(p.id)}
          />
        ))}
      </div>
    </Modal>
  )
}

/* A button, so every child below has to be phrasing content — spans, not divs. */
function GoalCard({
  goal,
  selected,
  current,
  onSelect,
}: {
  goal: PrinterGoal
  selected: boolean
  current: boolean
  onSelect: () => void
}) {
  const load = Math.round((goal.hoursPerWeek / MAX_HOURS_PER_WEEK) * 100)

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cx(
        "sketch relative block w-full rounded-2xl px-4 pt-4 pb-3.5 text-left transition-colors duration-150 sm:px-5",
        !selected && "hover:bg-white",
      )}
      style={
        {
          "--sk-color": selected ? "var(--color-teal-deep)" : "var(--color-line)",
          "--sk-radius": "16px",
          background: selected ? "color-mix(in srgb, var(--color-mint) 52%, #fff)" : "var(--color-paper)",
        } as React.CSSProperties
      }
    >
      {/* the strip of tape that holds the one you chose to the wall */}
      {selected && (
        <span className="absolute -top-3 left-1/2 z-10 block w-[86px] -translate-x-1/2 -rotate-2 motion-safe:animate-[hl-pop_.3s_cubic-bezier(.16,1,.3,1)]">
          <span
            aria-hidden="true"
            className="torn-soft absolute inset-0 block rounded-[3px] bg-gold"
            style={{ boxShadow: "0 2px 5px rgba(28,26,89,.14)" }}
          />
          <span className="label relative block py-[5px] text-center text-[0.58rem] tracking-[0.14em] text-navy">
            selected
          </span>
        </span>
      )}

      <span className="flex items-start gap-3.5">
        {/* the maker's photo on its own white ground, so it reads as a photo
            on the mint of a selected card as much as on the paper of the rest */}
        <PrinterPhoto
          id={goal.id}
          sizes="(min-width: 1024px) 88px, 76px"
          className="size-[76px] shrink-0 rounded-xl border border-line/80 lg:size-[88px]"
        />

        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className={cx(
                "mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-full border-2 transition-colors",
                selected ? "border-transparent bg-teal-deep" : "border-line-strong",
              )}
            >
              {selected && <span className="size-[7px] rounded-full bg-white" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[1.02rem] leading-tight font-extrabold text-navy">{goal.name}</span>
              {current && <span className="hand mt-0.5 block text-[0.72rem] text-teal-ink">your goal right now</span>}
            </span>
            {goal.note && (
              <span
                className={cx(
                  "label mt-px shrink-0 rounded-full px-2 py-1 text-[0.6rem]",
                  goal.note === "Resin" ? "bg-gold-pale text-gold-ink" : "bg-coral/15 text-coral-dark",
                )}
              >
                {goal.note}
              </span>
            )}
          </span>

          <span className="mt-1.5 block text-[0.79rem] leading-snug text-navy-soft">{goal.blurb}</span>
        </span>
      </span>

      <span className="mt-3.5 block border-t border-dashed border-line/90 pt-3">
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="flex items-baseline gap-1.5">
            <IconCoin className="translate-y-0.5 text-[1.05rem] text-orange" />
            <span className="text-[1.05rem] leading-none font-extrabold tabular-nums text-navy">
              {goal.coins.toLocaleString()}
            </span>
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-[0.79rem] font-semibold text-teal-ink">
            <IconClock className="text-[0.95rem]" />
            <span className="tabular-nums">{goal.hoursPerWeek.toFixed(1)}</span> hrs/design wk
          </span>
        </span>

        {/* how steep the weekly commitment is, against the steepest on the board */}
        <span
          aria-hidden="true"
          className="relative mt-2 block h-[5px] w-full rounded-full"
          style={{ background: "rgba(28,26,89,.09)" }}
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-teal transition-[width] duration-500 ease-out"
            style={{ width: `${load}%` }}
          />
        </span>
      </span>
    </button>
  )
}
