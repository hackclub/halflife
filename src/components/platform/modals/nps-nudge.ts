/**
 * Whether the NPS prompt owns the screen: one of its steps is up, or it is still deciding whether to show.
 *
 * Two readers depend on this. The sticker promotion stands down rather than sitting under a blocking dialog, and the address reminder waits for the prompt to finish so the two never open at once. The banner lives in the app shell and the prompt lives on the dashboard page, so a module-level flag with subscribers is how they meet – the same shape as the promo's own mode store.
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
