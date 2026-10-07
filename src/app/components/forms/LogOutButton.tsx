"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { signOut } from "@/lib/auth-client"

/** The sidebar's "LOG OUT" – an accent label in the comp, not a button. */
export function LogOutButton() {
	const router = useRouter()
	const [busy, setBusy] = useState(false)

	return (
		<button
			type="button"
			className="hl-label"
			style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}
			disabled={busy}
			onClick={async () => {
				setBusy(true)
				try {
					await signOut()
					router.push("/")
					router.refresh()
				} finally {
					setBusy(false)
				}
			}}
		>
			{busy ? "Signing out…" : "Log out"}
		</button>
	)
}
