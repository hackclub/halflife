"use client"

import { useState } from "react"
import { WeekPainting } from "@/components/platform/art"
import { IconArrowRight } from "@/components/platform/icons"
import { WarmupModal } from "@/components/platform/modals/WarmupModal"
import { Button, Panel } from "@/components/platform/ui"
import { WARMUP_THEME, WARMUP_WEEK_ID } from "@/lib/config/program"
import { useStore } from "@/lib/store"

/**
 * Where the intro sends someone who arrives before week 1: the way into a warm-up project. Shown while week 1 has not opened. A maker may start as many warm-ups as they like, so once they have one it steps back to a single line above their projects instead of leading the page.
 */
export function WarmupStart() {
	const { hydrated, projects, weekStarted, weekOpensOn, warmupDeadline } = useStore()
	const [open, setOpen] = useState(false)

	if (!hydrated || weekStarted(1)) return null
	const opensOn = weekOpensOn(1)
	const modal = open && <WarmupModal closesOn={warmupDeadline} onClose={() => setOpen(false)} />

	if (projects.some(p => p.weekId === WARMUP_WEEK_ID)) {
		return (
			<>
				<div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
					<p className="hand text-[0.86rem] text-navy-soft">warm-ups close {warmupDeadline}.</p>
					<Button onClick={() => setOpen(true)} size="sm" variant="outline">
						Start another warm-up project <IconArrowRight className="text-base" />
					</Button>
				</div>
				{modal}
			</>
		)
	}

	return (
		<>
			<Panel className="@container mb-6 overflow-hidden bg-paper" radius={22} tone="violet">
				<div className="grid @2xl:grid-cols-[minmax(0,1fr)_240px]">
					<div className="px-6 py-6 sm:px-8 sm:py-7">
						<h2 className="text-[1.9rem] leading-[1.15] font-extrabold tracking-[-0.03em] text-balance text-navy">
							Start a warm-up project
						</h2>
						<p className="mt-3 max-w-[58ch] text-[0.95rem] leading-relaxed text-navy-soft">
							{opensOn ? `Week 1 opens ${opensOn}.` : "Week 1 has not opened yet."} Until then, build any hardware
							project you like, no theme. You journal it and submit it for review as a design that requests funding or
							as a build.
						</p>
						<div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
							<Button onClick={() => setOpen(true)} variant="solid">
								Start warm-up project <IconArrowRight className="text-base" />
							</Button>
							<span className="hand text-[0.84rem] text-navy-soft">warm-ups close {warmupDeadline}.</span>
						</div>
					</div>
					<div className="order-first grid place-items-center bg-violet-pale px-6 py-5 @2xl:order-none">
						<WeekPainting
							alt=""
							className="aspect-square w-[150px] @2xl:w-[190px]"
							sizes="(min-width: 768px) 190px, 150px"
							theme={WARMUP_THEME.label}
						/>
					</div>
				</div>
			</Panel>
			{modal}
		</>
	)
}
