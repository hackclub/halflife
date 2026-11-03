"use client"

import { useState } from "react"
import { ExtensionForm } from "@/app/components/forms/ExtensionForm"
import { Select } from "@/app/components/ui"

export interface WeekExtensionOption {
	/** ISO string of the week's extension now on record, if any. */
	current: string | null
	label: string
	week: number
}

/**
 * Pick one program week and grant it time.
 *
 * The week select comes before the date because the date means nothing without it: a grant written here is stored against the week, not its project, so it works for a week the participant has not started yet.
 */
export function WeekExtensionForm({
	options,
	urlPrefix,
}: Readonly<{
	options: WeekExtensionOption[]
	/** The week number is appended, e.g. `/api/admin/users/abc/weeks/3`. */
	urlPrefix: string
}>) {
	const [week, setWeek] = useState(options[0]?.week ?? 1)
	const selected = options.find(option => option.week === week)

	return (
		<div className="hl-stack hl-stack--tight">
			<Select
				aria-label="Week"
				onChange={event => setWeek(Number(event.target.value))}
				style={{ maxWidth: "24rem" }}
				value={week}
			>
				{options.map(option => (
					<option key={option.week} value={option.week}>
						{option.label}
					</option>
				))}
			</Select>
			<ExtensionForm current={selected?.current ?? null} key={week} url={`${urlPrefix}/${week}`} />
		</div>
	)
}
