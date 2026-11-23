/**
 * The staff console's remembered light/dark mode.
 *
 * This is a browser preference: no account field, no migration, no request. `browser-storage` keeps the write for the visit even where storage is blocked, and a `storage` event from another tab reads the mode afresh here. The attribute on `<html>` is what CSS reads; `ops.css` scopes its dark overrides to the admin frame, so leaving the console leaves the rest of the platform light. `ThemeBootScript` puts the remembered attribute on `<html>` before the first paint.
 */

import { readStored, subscribeStorage, writeStored } from "./browser-storage"

export type AdminTheme = "light" | "dark"

export const ADMIN_THEME_KEY = "half-life:admin:theme"

const isTheme = (value: string | null): value is AdminTheme => value === "light" || value === "dark"

/** The remembered mode, or the console default when there is none or it is nonsense. */
export function getAdminTheme(): AdminTheme {
	const value = readStored(ADMIN_THEME_KEY)
	return isTheme(value) ? value : "light"
}

/** The server has no storage, so every page starts light and the client applies the remembered mode after hydration. */
export function getServerAdminTheme(): AdminTheme {
	return "light"
}

/** Storage writes in this tab and in others, each of which reads the mode again. */
export function subscribeAdminTheme(listener: () => void): () => void {
	return subscribeStorage(listener)
}

/** Put the mode on `<html>` where the stylesheet can see it. */
export function applyAdminTheme(theme: AdminTheme): void {
	document.documentElement.dataset.theme = theme
}

export function setAdminTheme(theme: AdminTheme): void {
	applyAdminTheme(theme)
	writeStored(ADMIN_THEME_KEY, theme)
}

/** Returns the new mode so a caller can announce it without reading storage twice. */
export function toggleAdminTheme(): AdminTheme {
	const theme: AdminTheme = getAdminTheme() === "dark" ? "light" : "dark"
	setAdminTheme(theme)
	return theme
}
