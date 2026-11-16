/**
 * Browser storage without React, so it can be read and tested anywhere. The hooks over it live in `browser-state`.
 *
 * Every access is guarded. A private window or blocked site data throws on `localStorage`; writes are then kept in memory for the visit, so the value still reads back the way it was written.
 */

const listeners = new Set<() => void>()
const memory = new Map<string, string | null>()

/** Subscribe to every write in this tab, and to the `storage` event from other tabs. */
export function subscribeStorage(listener: () => void): () => void {
	listeners.add(listener)
	window.addEventListener("storage", listener)
	return () => {
		listeners.delete(listener)
		window.removeEventListener("storage", listener)
	}
}

/** The stored value for a key, or null when there is none. */
export function readStored(key: string): string | null {
	if (memory.has(key)) return memory.get(key) ?? null
	try {
		return localStorage.getItem(key)
	} catch {
		return null
	}
}

/** Store a value, or remove the key with null, and tell every subscriber in this tab. */
export function writeStored(key: string, value: string | null): void {
	try {
		if (value === null) localStorage.removeItem(key)
		else localStorage.setItem(key, value)
		memory.delete(key)
	} catch {
		memory.set(key, value)
	}
	for (const listener of listeners) listener()
}
