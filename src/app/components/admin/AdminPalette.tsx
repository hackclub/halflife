"use client"

import { useRouter } from "next/navigation"
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useState } from "react"
import { Modal } from "@/app/components/ui/Modal"
import type { AdminNavGroup, AdminNavItem } from "./admin-nav"

interface PaletteEntry extends AdminNavItem {
	group: string
}

const SEARCH_GROUP = "Search"

const flatten = (groups: AdminNavGroup[]): PaletteEntry[] =>
	groups.flatMap(group => group.items.map(item => ({ ...item, group: group.label })))

/**
 * Jump to any admin page from the keyboard, and search the users directory without leaving the keyboard either. Opened with Ctrl K or Cmd K from anywhere in the console, or the button in the header.
 */
export function AdminPalette({ groups }: Readonly<{ groups: AdminNavGroup[] }>) {
	const router = useRouter()
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState("")
	const [active, setActive] = useState(0)

	useEffect(() => {
		const onKey = (event: globalThis.KeyboardEvent): void => {
			if (!(event.key === "k" && (event.ctrlKey || event.metaKey))) return
			event.preventDefault()
			setOpen(value => !value)
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [])

	const term = query.trim().toLowerCase()
	const pages = flatten(groups).filter(
		entry => term === "" || `${entry.label} ${entry.group}`.toLowerCase().includes(term),
	)
	const hasUsers = groups.some(group => group.items.some(item => item.href === "/admin/users"))
	const entries: PaletteEntry[] =
		term.length >= 2 && hasUsers
			? [
					...pages,
					{
						group: SEARCH_GROUP,
						href: `/admin/users?q=${encodeURIComponent(query.trim())}`,
						label: `Find users matching "${query.trim()}"`,
					},
				]
			: pages
	const current = Math.min(active, Math.max(entries.length - 1, 0))

	const close = (): void => {
		setOpen(false)
		setQuery("")
		setActive(0)
	}

	const go = (entry: PaletteEntry | undefined): void => {
		if (!entry) return
		close()
		if (entry.hard) {
			window.location.assign(entry.href)
			return
		}
		router.push(entry.href)
	}

	const onInputKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
		if (event.key === "ArrowDown") {
			event.preventDefault()
			setActive(current + 1 >= entries.length ? 0 : current + 1)
		}
		if (event.key === "ArrowUp") {
			event.preventDefault()
			setActive(current - 1 < 0 ? Math.max(entries.length - 1, 0) : current - 1)
		}
		if (event.key === "Enter") {
			event.preventDefault()
			go(entries[current])
		}
	}

	return (
		<>
			<button className="hl-btn hl-admin-search" onClick={() => setOpen(true)} type="button">
				Search <kbd className="hl-admin-kbd">Ctrl K</kbd>
			</button>
			<Modal onClose={close} open={open} title="Search the admin console">
				<div className="hl-stack hl-stack--tight">
					{/* The native dialog moves focus into its first control on open, which is this field, so no autoFocus is needed. */}
					<input
						aria-autocomplete="list"
						aria-controls="admin-palette-list"
						className="hl-input"
						onChange={event => {
							setQuery(event.target.value)
							setActive(0)
						}}
						onKeyDown={onInputKey}
						placeholder="Go to a page, or type a name or email to find a user"
						value={query}
					/>
					<div aria-label="Matching pages" className="hl-admin-palette-list" id="admin-palette-list" role="listbox">
						{entries.length === 0 ? <p className="hl-muted">Nothing matches.</p> : null}
						{entries.map((entry, index) => (
							<button
								aria-selected={index === current}
								className="hl-admin-palette-item"
								data-active={index === current ? "true" : undefined}
								key={`${entry.group}-${entry.href}`}
								onClick={() => go(entry)}
								onMouseEnter={() => setActive(index)}
								role="option"
								type="button"
							>
								<span>{entry.label}</span>
								<span className="hl-hint">{entry.group}</span>
							</button>
						))}
					</div>
				</div>
			</Modal>
		</>
	)
}
