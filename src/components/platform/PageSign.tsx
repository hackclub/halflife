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
}: {
	label: string
	sub?: ReactNode
	color?: string
	ink?: string
	stripe?: string
}) {
	return <HangingSign color={color} ink={ink} stripe={stripe} subtitle={sub} surface="platform" title={label} />
}
