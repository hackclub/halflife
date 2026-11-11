/** Fabricate's display formatters (`app/javascript/lib/format.ts`), minus scraps, which Half Life has no counterpart for. */

export function formatDuration(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined) return "—"
	const minutes = Math.floor(seconds / 60)
	const h = Math.floor(minutes / 60)
	const m = minutes % 60
	if (h === 0) return `${m}m`
	if (m === 0) return `${h}h`
	return `${h}h ${m}m`
}

export const formatDollars = (amount: number): string => `$${amount.toFixed(2)}`

export const formatHours = (hours: number): string => `${(Math.round(hours * 10) / 10).toFixed(1)}h`

export const ageTone = (days: number): "bad" | "warn" | "ok" => (days >= 7 ? "bad" : days >= 3 ? "warn" : "ok")

const VIDEO = /\.(mp4|webm|mov|m4v)(\?|#|$)/i

export const isVideoUrl = (url: string): boolean => VIDEO.test(url)
