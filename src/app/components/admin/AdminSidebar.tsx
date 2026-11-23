"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from "react"
import { HardLink } from "@/components/site/HardLink"
import { ADMIN_HOTKEYS, type AdminNavGroup, type AdminNavItem, isAdminNavActive } from "./admin-nav"
import { useAltHeld } from "./use-alt-held"

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
	const altHeld = useAltHeld()
	// The page a click or shortcut is heading for, lit before the router has swapped the page.
	const [pendingHref, setPendingHref] = useState<string | null>(null)
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
			if (event.repeat || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
			// The typed letter first, so a non-QWERTY layout answers to the key it prints; the physical code second, because Option+letter on a Mac types a character and `key` stops being a letter.
			const typed = event.key.length === 1 ? event.key.toLowerCase() : ""
			const physical = event.code.startsWith("Key") ? event.code.slice(3).toLowerCase() : ""
			const item = shortcuts.get(typed) ?? shortcuts.get(physical)
			if (!item) return
			event.preventDefault()
			setPendingHref(item.href)
			if (item.hard) {
				window.location.assign(item.href)
				return
			}
			router.push(item.href)
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [router, shortcuts])

	// The highlight is optimistic: it stops once the page it was heading for is the page shown, and the timeout clears a navigation that never lands.
	useEffect(() => {
		if (pendingHref === null) return
		const timer = window.setTimeout(() => setPendingHref(null), 6000)
		return () => window.clearTimeout(timer)
	}, [pendingHref])

	// Back and forward change the page with no click in between, so the pill from the last click has no landing to wait for.
	useEffect(() => {
		const clear = (): void => setPendingHref(null)
		window.addEventListener("popstate", clear)
		return () => window.removeEventListener("popstate", clear)
	}, [])

	// A click lights the destination before the router does. Modified clicks open elsewhere and leave this page as it is.
	const onClickCapture = (event: ReactMouseEvent<HTMLElement>): void => {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
		const anchor = event.target instanceof Element ? event.target.closest("a") : null
		const href = anchor?.getAttribute("href")
		if (href) setPendingHref(href)
	}

	return (
		<nav aria-label="Admin sections" className="hl-admin-side" onClickCapture={onClickCapture}>
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
							const pending = pendingHref === item.href && pendingHref !== pathname && !active
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
										className={pending ? "hl-pending" : undefined}
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
									className={pending ? "hl-admin-link hl-pending" : "hl-admin-link"}
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
