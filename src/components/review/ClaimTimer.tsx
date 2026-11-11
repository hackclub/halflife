"use client"

import { useEffect, useState } from "react"

/** How long a claim has left, ticking down. Fabricate's `ClaimTimer`, unchanged. */
export function ClaimTimer({ expiresAt }: { expiresAt: string }) {
	const [now, setNow] = useState(() => Date.now())
	const left = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000))
	const expired = left === 0

	useEffect(() => {
		if (expired) return
		const id = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(id)
	}, [expired])

	if (expired) return <span className="field__hint">claim expired</span>
	return (
		<span className="num" suppressHydrationWarning>
			{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} left
		</span>
	)
}
