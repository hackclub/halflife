"use client"

import { useEffect, useState } from "react"

/**
 * Copies a guide's code block. Guides are followed with the editor open beside them, so the sketch should go across in one click, not a careful drag-select that misses the last brace.
 */
export function CopyCode({ code }: { code: string }) {
	const [state, setState] = useState<"idle" | "copied" | "failed">("idle")

	useEffect(() => {
		if (state === "idle") return
		const t = setTimeout(() => setState("idle"), 1800)
		return () => clearTimeout(t)
	}, [state])

	const copy = async (): Promise<void> => {
		try {
			await navigator.clipboard.writeText(code)
			setState("copied")
		} catch {
			setState("failed")
		}
	}

	return (
		<button
			aria-live="polite"
			className="label rounded-md px-2 py-0.5 text-[0.7rem] text-white/85 transition-colors hover:bg-white/15 hover:text-white"
			onClick={copy}
			type="button"
		>
			{state === "copied" ? "Copied!" : state === "failed" ? "Select it instead" : "Copy"}
		</button>
	)
}
