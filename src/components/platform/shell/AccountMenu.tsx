"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { Avatar } from "@/components/platform/Avatar"
import { IconLogout } from "@/components/platform/icons"
import { Panel } from "@/components/platform/ui"
import { signOut } from "@/lib/auth-client"
import { cx } from "@/lib/cx"
import { useStore } from "@/lib/store"

/**
 * The account card for a phone, where the left rail it lives in on desktop is gone.
 *
 * Kept as a small menu rather than a seventh tab: six is what the bottom bar holds at 360px, and profile and log out are not destinations a maker needs in the same row as the trail. The avatar is the one control that does not need a label to be recognised, and its menu carries the two things the rail's card carries.
 */
export function AccountMenu({ className }: { className?: string }) {
	const { viewer } = useStore()
	const router = useRouter()
	const [open, setOpen] = useState(false)
	const [signingOut, setSigningOut] = useState(false)
	const root = useRef<HTMLDivElement>(null)

	// A menu that stays open over a page change or swallows the next tap on the page is worse than no menu. Escape and a press anywhere outside both close it; the link and the log-out press close it themselves.
	useEffect(() => {
		if (!open) return
		const closeOnPress = (event: PointerEvent) => {
			const { target } = event
			if (target instanceof Node && root.current && !root.current.contains(target)) setOpen(false)
		}
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false)
		}
		document.addEventListener("pointerdown", closeOnPress)
		document.addEventListener("keydown", closeOnEscape)
		return () => {
			document.removeEventListener("pointerdown", closeOnPress)
			document.removeEventListener("keydown", closeOnEscape)
		}
	}, [open])

	return (
		<div className={cx("relative shrink-0", className)} ref={root}>
			<button
				aria-expanded={open}
				aria-haspopup="menu"
				aria-label="Account menu"
				className="grid size-9 place-items-center rounded-full border-2 border-line bg-paper transition-colors hover:border-violet"
				onClick={() => setOpen(value => !value)}
				title="Account"
				type="button"
			>
				<Avatar className="size-7 text-[0.78rem]" image={viewer.image} name={viewer.name} shape="round" />
			</button>

			{open && (
				<Panel className="absolute top-full right-0 z-50 mt-2 w-56 bg-paper p-1.5" radius={16} tone="line">
					<div aria-hidden="true" className="px-3 pt-1.5 pb-2">
						<p className="label text-navy-faint">Signed in as</p>
						<p className="mt-1 truncate text-[0.9rem] font-extrabold text-navy">{viewer.name}</p>
					</div>
					<Link
						className="flex items-center rounded-xl px-3 py-2 text-[0.9rem] font-semibold text-navy-soft transition-colors hover:bg-black/[.03] hover:text-navy"
						href={`/u/${viewer.id}`}
						onClick={() => setOpen(false)}
					>
						Your profile
					</Link>
					<button
						className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[0.9rem] font-semibold text-navy-soft transition-colors hover:bg-coral/10 hover:text-coral-deep disabled:opacity-60"
						disabled={signingOut}
						onClick={async () => {
							setSigningOut(true)
							try {
								await signOut()
								setOpen(false)
								router.push("/")
								router.refresh()
							} finally {
								setSigningOut(false)
							}
						}}
						type="button"
					>
						{signingOut ? "Signing out…" : "Log out"}
						<IconLogout className="text-[1rem]" />
					</button>
				</Panel>
			)}
		</div>
	)
}
