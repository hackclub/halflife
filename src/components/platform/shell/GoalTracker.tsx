"use client"

import { useState } from "react"
import { ParticipantGoal } from "@/app/generated/prisma/enums"
import { PrinterPhoto } from "@/components/platform/art"
import { IconCoin } from "@/components/platform/icons"
import { GoalModal } from "@/components/platform/modals/GoalModal"
import { cx, Meter, Panel } from "@/components/platform/ui"
import { printerById } from "@/lib/config/printers"
import { useStore } from "@/lib/store"

/**
 * What this participant is here for, and how far along they are.
 *
 * It rides whichever rail the viewport hands it – the nav rail on the left below
 * xl, the status rail on the right above it – so it sizes itself from its
 * container rather than from the window, and neither slot has to be told which
 * one it is.
 *
 * The two branches exist because the answer changed what the panel is for.
 * Somebody saving for a machine gets the machine and the pace to it. Somebody
 * here for the grant has no machine to be on track for, and telling them they
 * are "on track to get a Bambu A1" a second after they said that was never the
 * goal would be the platform arguing with its own question. They get their
 * ordinary coins instead, which is what their hours actually buy them.
 *
 * Only the copy changes between the two. The pace, the hours a design week asks
 * for and what an approval mints are all still read from the printer column, so
 * nothing here quietly changes what anybody is owed.
 */
export function GoalTracker({ className }: { className?: string }) {
	// The whole balance, not the spendable pot alone. Every coin counts toward
	// the machine – a meter reading anything less would sit near zero all
	// season while the money for it piled up out of sight.
	const { printerFund, goalId, participantGoal, coins } = useStore()
	const [open, setOpen] = useState(false)
	const goal = printerById(goalId)
	// Null means the answer has not been given yet. Until it has, the panel keeps
	// showing the machine rather than guessing at a reading.
	const chasing = participantGoal === null || participantGoal === ParticipantGoal.PRINTER

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
				Change goal
			</button>

			{chasing ? (
				<>
					{/* The maker's photo on its own white tile, held inside the corner: unlike
          the drawn machine it has a ground, and a photo bleeding off the edge
          reads as cropped rather than propped up. The name beside it is its
          label, so the image itself stays silent. */}
					<span className="pointer-events-none absolute top-3 right-3 size-20 @min-[16rem]:top-4 @min-[16rem]:right-4 @min-[16rem]:size-24">
						<PrinterPhoto id={goal.id} sizes="96px" className="size-full rounded-xl border border-line/80" />
					</span>
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
				</>
			) : (
				<>
					{/* No width cap and no big top gap on this side, unlike the branch above.
              Both of those are there to keep clear of the photo pinned in the
              corner; with no photo there is nothing to clear, so keeping them
              left the text hugging the left edge with dead space beside it. */}
					<p className="mt-5 text-[0.92rem] leading-snug font-semibold text-navy @min-[16rem]:mt-6 @min-[16rem]:text-[1rem]">
						You&apos;re here for the <span className="text-teal-ink">funding</span>
					</p>
					{/* No meter here, and deliberately: the printer branch's bar measures
              progress toward a price, and there is no price on this side. A bar
              toward a number nobody set would imply somebody is behind a target
              that was never theirs. The coins are the whole reading. */}
					<p className="mt-2 flex items-baseline gap-2 @min-[16rem]:mt-3">
						<IconCoin className="translate-y-0.5 text-[1.15rem] text-orange" />
						<span className="text-[1.15rem] leading-none font-extrabold tabular-nums text-navy">
							{coins.toLocaleString()}
						</span>
						<span className="text-[0.8rem] font-semibold text-navy-soft">coins earned</span>
					</p>
					<p className="hand mt-2 text-[0.78rem] leading-snug text-navy-soft">
						Your hours buy the parts for your project, and everything past that is yours to spend.
					</p>
				</>
			)}

			<GoalModal open={open} onClose={() => setOpen(false)} />
		</Panel>
	)
}
