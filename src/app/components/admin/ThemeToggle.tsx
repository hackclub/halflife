"use client"

import { useEffect, useSyncExternalStore } from "react"
import { IconMoon, IconSun } from "@/app/components/ui/icons"
import {
	applyAdminTheme,
	getAdminTheme,
	getServerAdminTheme,
	subscribeAdminTheme,
	toggleAdminTheme,
} from "@/lib/admin-theme"

/**
 * One icon button in the console header for the remembered light/dark mode.
 *
 * The server draws the light icon, then the client reads the stored mode straight after hydration through `useSyncExternalStore`, so no effect has to copy it into state. Applying the attribute is a separate effect, where touching the document is safe.
 */
export function ThemeToggle() {
	const theme = useSyncExternalStore(subscribeAdminTheme, getAdminTheme, getServerAdminTheme)
	const next = theme === "dark" ? "light" : "dark"

	useEffect(() => {
		applyAdminTheme(theme)
	}, [theme])

	return (
		<button
			aria-label={`Switch to ${next} mode`}
			className="hl-icon-btn"
			onClick={() => toggleAdminTheme()}
			title={`Switch to ${next} mode`}
			type="button"
		>
			{theme === "dark" ? <IconMoon /> : <IconSun />}
		</button>
	)
}
