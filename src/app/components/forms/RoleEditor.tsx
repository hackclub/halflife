"use client"
import { Button, Callout } from "@/app/components/ui"
import { sendJson, useAction } from "@/lib/use-action"

const ROLES = ["ADMIN", "REVIEWER", "FULFILLER", "AUDITOR"] as const

export function RoleEditor({ userId, current }: Readonly<{ userId: string; current: string[] }>) {
	const { busy, error, run } = useAction()

	function toggle(role: string, held: boolean) {
		void run(role, () =>
			sendJson(`/api/admin/users/${userId}/roles`, {
				method: held ? "DELETE" : "POST",
				body: { role },
			}),
		)
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
