/**
 * Whether the shipping-address reminder is on screen.
 *
 * The identity reminder waits for it, so the two never open at once. Same shape as the NPS prompt's flag: a module-level value with subscribers, because the two reminders are mounted in the same shell and read each other through it.
 */
let addressOpen = false

const listeners = new Set<() => void>()

export function setAddressReminderOpen(value: boolean): void {
	if (addressOpen === value) return
	addressOpen = value
	for (const listener of listeners) listener()
}

export function subscribeAddressReminderOpen(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function getAddressReminderOpen(): boolean {
	return addressOpen
}
