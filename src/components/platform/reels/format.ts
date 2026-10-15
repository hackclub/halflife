/** 1234 → "1.2k". Counts on a reel are glanced at, not read. */
export function compact(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`
	if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
	return `${n}`
}

/** Seconds as the player's clock: 00:07, 01:29, 1:02:10. */
export function clock(seconds: number): string {
	const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
	const h = Math.floor(s / 3600)
	const m = Math.floor((s % 3600) / 60)
	const pad = (n: number) => n.toString().padStart(2, "0")
	return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

/**
 * How long ago, the way a feed says it: "now", "5m ago", "3h ago", "6d ago", "2w ago", and past a month the date itself – "ago" stops meaning anything once it has to be worked out.
 */
export function ago(when: Date | string | null | undefined, now = Date.now()): string {
	if (!when) return ""
	const t = new Date(when).getTime()
	if (Number.isNaN(t)) return ""
	const s = Math.max(0, Math.round((now - t) / 1000))
	if (s < 60) return "now"
	const m = Math.floor(s / 60)
	if (m < 60) return `${m}m ago`
	const h = Math.floor(m / 60)
	if (h < 24) return `${h}h ago`
	const d = Math.floor(h / 24)
	if (d < 7) return `${d}d ago`
	if (d < 35) return `${Math.floor(d / 7)}w ago`
	const date = new Date(t)
	const sameYear = date.getFullYear() === new Date(now).getFullYear()
	return date.toLocaleDateString("en-US", {
		day: "numeric",
		month: "short",
		...(sameYear ? {} : { year: "numeric" }),
	})
}
