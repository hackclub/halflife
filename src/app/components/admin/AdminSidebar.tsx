"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { HardLink } from "@/components/site/HardLink"
import { ADMIN_HOTKEYS, type AdminNavGroup, type AdminNavItem, isAdminNavActive } from "./admin-nav"

/**
 * The admin sections down the left of the console. Grouped, so the eye finds a page by its area rather than scanning one long row, and fixed in the column so a long page does not take the navigation away.
 *
 * On a phone the list sits behind one "Sections" button and closes again once a page is chosen. On a desktop the list is always shown, and the button is hidden.
 *
 * Each page also answers to an Alt shortcut. Holding Alt puts its key at the end of the name; pressing Alt and the key opens the page. Holding Alt is the whole discovery mechanism, so nobody has to learn the keys from a list first.
 */
export function AdminSidebar({ groups }: Readonly<{ groups: AdminNavGroup[] }>) {
	const pathname = usePathname()
	const router = useRouter()
	// The list is open for the page it was opened on, so choosing another page folds it away again without an effect.
	const [openPath, setOpenPath] = useState<string | null>(null)
	const open = openPath === pathname
	const [altHeld, setAltHeld] = useState(false)
	// The item each key opens, so a hard link can still leave the router for a full load.
	const shortcuts = useMemo(() => {
		const byKey = new Map<string, AdminNavItem>()
		for (const group of groups)
			for (const item of group.items) {
				const key = ADMIN_HOTKEYS[item.href]
				if (key) byKey.set(key, item)
			}
		return byKey
	}, [groups])

	useEffect(() => {
		const onKeyDown = (event: globalThis.KeyboardEvent): void => {
			if (event.key === "Alt") {
				// AltGr arrives as Ctrl+Alt, and that is typing, not a shortcut.
				if (!event.ctrlKey && !event.metaKey && !event.shiftKey) setAltHeld(true)
				return
			}
			if (event.repeat || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
			// The typed letter first, so a non-QWERTY layout answers to the key it prints; the physical code second, because Option+letter on a Mac types a character and `key` stops being a letter.
			const typed = event.key.length === 1 ? event.key.toLowerCase() : ""
			const physical = event.code.startsWith("Key") ? event.code.slice(3).toLowerCase() : ""
			const item = shortcuts.get(typed) ?? shortcuts.get(physical)
			if (!item) return
			event.preventDefault()
			if (item.hard) {
				window.location.assign(item.href)
				return
			}
			router.push(item.href)
		}
		const onKeyUp = (event: globalThis.KeyboardEvent): void => {
			if (event.key === "Alt") setAltHeld(false)
		}
		// Losing focus mid-Alt never sends the keyup, so the chips would stay on show.
		const onBlur = (): void => setAltHeld(false)
		window.addEventListener("keydown", onKeyDown)
		window.addEventListener("keyup", onKeyUp)
		window.addEventListener("blur", onBlur)
		return () => {
			window.removeEventListener("keydown", onKeyDown)
			window.removeEventListener("keyup", onKeyUp)
			window.removeEventListener("blur", onBlur)
		}
	}, [router, shortcuts])

	return (
		<nav aria-label="Admin sections" className="hl-admin-side">
			<button
				aria-controls="admin-sections"
				aria-expanded={open}
				className="hl-admin-menu-toggle"
				onClick={() => setOpenPath(open ? null : pathname)}
				type="button"
			>
				Sections
			</button>
			<div className="hl-admin-side-inner" data-open={open ? "true" : "false"} id="admin-sections">
				{groups.map(group => (
					<div className="hl-admin-group" key={group.label}>
						<div className="hl-admin-group-label">{group.label}</div>
						{group.items.map(item => {
							const active = isAdminNavActive(pathname, item.href)
							const key = ADMIN_HOTKEYS[item.href]
							const body = (
								<>
									<span>{item.label}</span>
									{altHeld && key ? <kbd className="hl-hotkey">{key.toUpperCase()}</kbd> : null}
								</>
							)
							if (item.hard)
								return (
									<HardLink
										aria-keyshortcuts={key ? `Alt+${key.toUpperCase()}` : undefined}
										href={item.href}
										key={item.href}
									>
										{body}
									</HardLink>
								)
							return (
								<Link
									aria-current={active ? "page" : undefined}
									aria-keyshortcuts={key ? `Alt+${key.toUpperCase()}` : undefined}
									className="hl-admin-link"
									href={item.href}
									key={item.href}
								>
									{body}
								</Link>
							)
						})}
					</div>
				))}
			</div>
		</nav>
	)
}
