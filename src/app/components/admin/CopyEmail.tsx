"use client"

import { useEffect, useState } from "react"

interface Props {
	email: string
}

/**
 * The address in the users table, copied by clicking it. A staff member searching for an account usually wants the address somewhere else next, and dragging across a monospace cell for it is work the click should do.
 */
export function CopyEmail({ email }: Props) {
	const [state, setState] = useState<"idle" | "copied" | "failed">("idle")

	useEffect(() => {
		if (state === "idle") return
		const timeout = setTimeout(() => setState("idle"), 1800)
		return () => clearTimeout(timeout)
	}, [state])

	async function copy() {
		try {
			await navigator.clipboard.writeText(email)
			setState("copied")
		} catch {
			setState("failed")
		}
	}

	return (
		<button
			aria-label={`Copy ${email}`}
			className="hl-copy hl-mono"
			onClick={() => void copy()}
			title="Copy this address"
			type="button"
		>
			{email}
			{state === "copied" ? (
				<span className="hl-copy-note" role="status">
					copied
				</span>
			) : null}
			{state === "failed" ? <span className="hl-copy-note">select it instead</span> : null}
		</button>
	)
}
