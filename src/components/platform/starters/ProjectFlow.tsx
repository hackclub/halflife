import { Panel } from "@/components/platform/ui"
import { cx } from "@/lib/cx"

interface Step {
	readonly body: string
	/** Done during the design week, so its puck is live; the rest wait their turn, like locked checkpoints on the trail. */
	readonly now: boolean
	readonly title: string
	readonly when: string
}

/**
 * Where a starter guide sits in a Half Life week. You design, journal and push to GitHub now, then submit for review, and only once you're approved do you buy parts – the build itself waits for the theme's build week. A guide covers the design, so this sits above it to stop anyone reaching for parts they don't have yet.
 */
export function ProjectFlow({ buildWeek, designWeek }: { buildWeek: number; designWeek: number }) {
	const steps: readonly Step[] = [
		{
			body: "Draw the schematic and PCB and write the firmware. Journal your hours as you go.",
			now: true,
			title: "Design it",
			when: `week ${designWeek}`,
		},
		{
			body: "Put your design files and firmware in your project's repo.",
			now: true,
			title: "Push to GitHub",
			when: `week ${designWeek}`,
		},
		{
			body: "A reviewer looks over your design.",
			now: true,
			title: "Submit",
			when: "when it's done",
		},
		{
			body: "Buy the parts on your BOM with your funding.",
			now: false,
			title: "Buy the parts",
			when: "once approved",
		},
		{
			body: "Put your board together and flash your firmware.",
			now: false,
			title: "Build it",
			when: `build week, week ${buildWeek}`,
		},
	]

	return (
		<Panel as="section" className="mt-10 bg-white" radius={18}>
			<div className="px-5 pt-5 pb-6 sm:px-6">
				<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
					<h2 className="label text-navy-soft">From design to build</h2>
					<p className="hand text-[0.86rem] text-navy-soft">
						this guide is all design. You won&apos;t need any parts until you&apos;re approved.
					</p>
				</div>
				<ol className="mt-5 grid gap-5 md:grid-cols-5 md:gap-3">
					{steps.map((step, n) => (
						<li
							className="relative flex gap-3.5 after:absolute after:top-13 after:-bottom-4 after:left-5 after:border-l-2 after:border-dashed after:border-line last:after:hidden md:flex-col md:gap-3 md:after:top-5 md:after:-right-1.5 md:after:bottom-auto md:after:left-14 md:after:border-t-2 md:after:border-l-0"
							key={step.title}
						>
							<span
								aria-hidden="true"
								className={cx("puck pointer-events-none w-10 shrink-0", !step.now && "puck-locked")}
							>
								<span className="puck-face text-[0.9rem] font-extrabold text-navy">{n + 1}</span>
							</span>
							<div className="min-w-0">
								<h3 className="text-[1rem] leading-tight font-extrabold text-navy">{step.title}</h3>
								<p className="hand text-[0.8rem] text-navy-soft">{step.when}</p>
								<p className="mt-1.5 max-w-[40ch] text-[0.88rem] leading-snug text-navy-soft">{step.body}</p>
							</div>
						</li>
					))}
				</ol>
			</div>
		</Panel>
	)
}
