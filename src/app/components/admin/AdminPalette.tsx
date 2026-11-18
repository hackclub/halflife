"use client"

import { useRouter } from "next/navigation"
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react"
import { Modal } from "@/app/components/ui/Modal"
import { type AdminNavGroup, type AdminPaletteEntry, paletteEntries } from "./admin-nav"

/**
 * Jump to any admin page from the keyboard, and search the users directory without leaving the keyboard either. Opened with Ctrl K or Cmd K from anywhere in the console, or the button in the header.
 */
export function AdminPalette({ groups }: Readonly<{ groups: AdminNavGroup[] }>) {
	const router = useRouter()
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState("")
	const [active, setActive] = useState(0)
	const inputRef = useRef<HTMLInputElement>(null)

	// The modal focuses its first control, which is the close button, so the field is focused explicitly once it is open.
	useEffect(() => {
		if (open) inputRef.current?.focus()
	}, [open])

	useEffect(() => {
		const onKey = (event: globalThis.KeyboardEvent): void => {
			if (!(event.key === "k" && (event.ctrlKey || event.metaKey))) return
			event.preventDefault()
			setOpen(value => !value)
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [])

	const entries = paletteEntries(groups, query)
	const current = Math.min(active, Math.max(entries.length - 1, 0))

	const close = (): void => {
		setOpen(false)
		setQuery("")
		setActive(0)
	}

	const go = (entry: AdminPaletteEntry | undefined): void => {
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
						ref={inputRef}
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
