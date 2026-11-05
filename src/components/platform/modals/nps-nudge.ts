/**
 * Whether the NPS follow-up is on screen, so the sticker promotion can get out of its way.
 *
 * The banner lives in the app shell and the follow-up lives on the dashboard page, so a module-level flag with subscribers is how the two meet – the same shape as the promo's own mode store.
 */
let nudgeActive = false

const listeners = new Set<() => void>()

export function setNpsNudgeActive(value: boolean): void {
	if (nudgeActive === value) return
	nudgeActive = value
	for (const listener of listeners) listener()
}

export function subscribeNpsNudgeActive(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function getNpsNudgeActive(): boolean {
	return nudgeActive
}
