"use client"
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react"
import { readStored, subscribeStorage } from "./browser-storage"

export { readStored, writeStored } from "./browser-storage"

/**
 * Browser-only state as stores React can subscribe to.
 *
 * The server has no storage, clock, zone or media query, so it draws the server snapshot. `useSyncExternalStore` hydrates with that same snapshot and then reads the real value straight after, so the first client render cannot disagree with the server, and no effect has to copy the value into state after mount.
 *
 * Storage access is guarded. A private window or blocked site data throws on `localStorage`; writes are then kept in memory for the visit, so the value still reads back the way it was written.
 */

/** The stored value for a key, kept in step with every write, including the `storage` event from other tabs. Null on the server. */
export function useStoredValue(key: string): string | null {
	return useSyncExternalStore(
		subscribeStorage,
		() => readStored(key),
		() => null,
	)
}

function subscribeNothing(): () => void {
	return () => undefined
}

/** False on the server and on the first client render, true once the client is running. */
export function useHydrated(): boolean {
	return useSyncExternalStore(
		subscribeNothing,
		() => true,
		() => false,
	)
}

/** The browser's own time zone, or the fallback on the server. */
export function useBrowserTimeZone(fallback: string): string {
	return useSyncExternalStore(
		subscribeNothing,
		() => Intl.DateTimeFormat().resolvedOptions().timeZone || fallback,
		() => fallback,
	)
}

function subscribeSecond(listener: () => void): () => void {
	const timer = setInterval(listener, 1000)
	return () => clearInterval(timer)
}

function currentSecond(): number {
	return Math.floor(Date.now() / 1000)
}

/** The current time, updated every second. Null on the server and before the first client render. */
export function useClock(): Date | null {
	const second = useSyncExternalStore(subscribeSecond, currentSecond, () => null)
	return useMemo(() => (second === null ? null : new Date(second * 1000)), [second])
}

/** Whether a media query matches, false on the server. */
export function useMediaQuery(query: string): boolean {
	const subscribe = useCallback(
		(listener: () => void) => {
			const mq = window.matchMedia(query)
			mq.addEventListener("change", listener)
			return () => mq.removeEventListener("change", listener)
		},
		[query],
	)
	const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])
	return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

function subscribeLocation(listener: () => void): () => void {
	window.addEventListener("popstate", listener)
	return () => window.removeEventListener("popstate", listener)
}

/** The query string of the address bar, empty on the server. */
export function useLocationSearch(): string {
	return useSyncExternalStore(
		subscribeLocation,
		() => window.location.search,
		() => "",
	)
}

/**
 * A value read once, the first time the client renders, and kept for the visit. Undefined on the server.
 *
 * For state that must not follow later writes: a position saved as the viewer moves on must not move the walk that brought them to it.
 */
export function useArrivalValue<T>(read: () => T): T | undefined {
	const arrived = useRef<{ value: T } | null>(null)
	const snapshot = useSyncExternalStore(
		subscribeNothing,
		() => {
			arrived.current ??= { value: read() }
			return arrived.current
		},
		() => null,
	)
	return snapshot?.value
}

/** A value computed in the browser, from the current inputs on every render, and the server value until then. */
export function useBrowserValue<T>(read: () => T, server: T): T {
	return useSyncExternalStore(subscribeNothing, read, () => server)
}
