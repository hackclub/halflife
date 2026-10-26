"use client"

import { useEffect, useState } from "react"
import { IconCheck } from "@/components/platform/icons"
import { cx } from "@/lib/cx"
import type { GuideHeading } from "./GuideBody"

/**
 * A guide's sections as a short stretch of the trail. Each is a puck; the ones you have read past turn teal and take a check, the one you are in wears the open sky face, and the rest wait in sand. It is the dashboard's own grammar for "how far along am I", so a long guide reads as distance covered rather than a scrollbar.
 */
export function ReadingTrail({ headings }: { headings: GuideHeading[] }) {
	const [current, setCurrent] = useState(0)

	useEffect(() => {
		const targets = headings.map(h => document.getElementById(h.id)).filter((el): el is HTMLElement => el !== null)
		if (targets.length === 0) return

		// The section you are in is the last heading above a line a third of the way down the window.
		const update = (): void => {
			const line = window.innerHeight / 3
			let index = 0
			for (const [n, el] of targets.entries()) if (el.getBoundingClientRect().top <= line) index = n

			setCurrent(index)
		}

		update()
		window.addEventListener("scroll", update, { passive: true })
		window.addEventListener("resize", update)
		return () => {
			window.removeEventListener("scroll", update)
			window.removeEventListener("resize", update)
		}
	}, [headings])

	return (
		<nav aria-label="Guide sections">
			<p className="label mb-4 text-navy-soft">In this guide</p>
			<ol className="relative grid gap-3.5">
				<span
					aria-hidden="true"
					className="absolute top-4 bottom-4 left-[0.95rem] border-l-[3px] border-dotted border-line-strong/60"
				/>
				{headings.map((h, n) => {
					const done = n < current
					const here = n === current
					return (
						<li className="relative" key={h.id}>
							<a
								aria-current={here ? "location" : undefined}
								className="group flex items-center gap-3 rounded-lg py-0.5 pr-2"
								href={`#${h.id}`}
							>
								<span
									className={cx("puck w-8 shrink-0", done ? "puck-done" : here ? "" : "puck-locked")}
									style={{ "--puck-lift": here ? "5px" : "3px" } as React.CSSProperties}
								>
									<span className="puck-face text-[0.95rem] text-white">
										{done ? <IconCheck /> : <span className="text-[0.72rem] font-extrabold text-navy">{n + 1}</span>}
									</span>
								</span>
								<span
									className={cx(
										"text-[0.9rem] leading-snug transition-colors",
										here ? "font-extrabold text-navy" : "font-semibold text-navy-soft group-hover:text-navy",
									)}
								>
									{h.text}
								</span>
							</a>
						</li>
					)
				})}
			</ol>
		</nav>
	)
}
