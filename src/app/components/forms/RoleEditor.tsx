"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout } from "@/app/components/ui"

const ROLES = ["ADMIN", "REVIEWER", "FULFILLER", "AUDITOR"] as const

export function RoleEditor({ userId, current }: Readonly<{ userId: string; current: string[] }>) {
	const router = useRouter()
	const [busy, setBusy] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	async function toggle(role: string, held: boolean) {
		setBusy(role)
		setError(null)
		try {
			const res = await fetch(`/api/admin/users/${userId}/roles`, {
				method: held ? "DELETE" : "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ role }),
			})
			if (!res.ok) {
				const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
				setError(payload.error?.message ?? `Failed (${res.status})`)
				return
			}
			router.refresh()
		} catch {
			setError("Could not reach the server")
		} finally {
			setBusy(null)
		}
	}

	return (
		<div className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}
			<div className="hl-row">
				{ROLES.map((role) => {
					const held = current.includes(role)
					return (
						<Button
							key={role}
							variant={held ? "danger" : "default"}
							disabled={busy !== null}
							onClick={() => toggle(role, held)}
						>
							{held ? `Remove ${role.toLowerCase()}` : `Grant ${role.toLowerCase()}`}
						</Button>
					)
				})}
			</div>
		</div>
	)
}
