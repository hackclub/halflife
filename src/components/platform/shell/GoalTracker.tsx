"use client"

import { useState } from "react"
import { PrinterArt } from "@/components/platform/art"
import { GoalModal } from "@/components/platform/modals/GoalModal"
import { cx, Meter, Panel } from "@/components/platform/ui"
import { printerById } from "@/lib/config/printers"
import { useStore } from "@/lib/store"

/**
 * What every coin is aimed at. It rides whichever rail the viewport hands it —
 * the nav rail on the left below xl, the status rail on the right above it — so
 * it sizes itself from its container rather than from the window, and neither
 * slot has to be told which one it is.
 */
export function GoalTracker({ className }: { className?: string }) {
  // The printer fund, not the spendable pot. A printer can be paid for out of
  // either, and most of what is aimed at it is banked — a meter reading the
  // spendable pot alone would sit near zero all season while the money for the
  // machine piled up out of sight.
  const { printerFund, goalId } = useStore()
  const [open, setOpen] = useState(false)
  const goal = printerById(goalId)

  return (
    <Panel
      tone="line"
      radius={18}
      className={cx(
        "@container relative overflow-hidden bg-cream/60 px-5 py-4 @min-[16rem]:px-6 @min-[16rem]:py-5",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="label relative z-10 text-sky-ink transition-colors hover:text-navy"
      >
        View more
      </button>
      <PrinterArt
        kind={goal.kind}
        className="pointer-events-none absolute -top-1 right-2 h-24 w-auto opacity-95 @min-[16rem]:-top-2 @min-[16rem]:right-3 @min-[16rem]:h-28"
      />
      <p className="mt-9 max-w-[62%] text-[0.92rem] leading-snug font-semibold text-navy @min-[16rem]:mt-11 @min-[16rem]:max-w-[60%] @min-[16rem]:text-[1rem]">
        You are on track to get a <span className="text-teal-ink">{goal.name}</span>
      </p>
      <Meter
        className="mt-3 @min-[16rem]:mt-4"
        value={printerFund}
        max={goal.coins}
        tone="teal"
        label={`${printerFund.toLocaleString()} / ${goal.coins.toLocaleString()}`}
      />

      <GoalModal open={open} onClose={() => setOpen(false)} />
    </Panel>
  )
}
