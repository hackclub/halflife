/**
 * Whether the NPS prompt owns the screen: one of its steps is up, or it is still deciding whether to show.
 *
 * The address and identity reminders read this and wait for the prompt to finish, so they never open on top of it. The reminders live in the app shell and the prompt lives on the dashboard page, so a module-level flag with subscribers is how they meet.
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
