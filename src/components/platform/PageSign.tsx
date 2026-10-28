import type { ReactNode } from "react"
import { HangingSign } from "@/components/sign/HangingSign"

/**
 * The platform's hanging shop sign, in the page's own accent. The shared implementation is `HangingSign`; this wrapper keeps the platform's names (`label`, `sub`) and the colour props at the call sites.
 */
export function PageSign({
	label,
	sub,
	color,
	ink,
	stripe,
	flush,
}: {
	label: string
	sub?: ReactNode
	color?: string
	ink?: string
	stripe?: string
	/** For a standalone document with no header above the sign; see `HangingSign`. */
	flush?: boolean
}) {
	return (
		<HangingSign
			color={color}
			flush={flush}
			ink={ink}
			stripe={stripe}
			subtitle={sub}
			surface="platform"
			title={label}
		/>
	)
}
