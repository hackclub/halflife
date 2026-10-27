import type { ReactNode } from "react"
import { Button } from "@/app/components/ui"

/** The open/closed marker on a Manage button. */
export function ManageChevron({ open }: { open: boolean }) {
	return (
		<svg
			aria-hidden="true"
			className={open ? "hl-manage-chevron hl-manage-chevron--open" : "hl-manage-chevron"}
			fill="none"
			viewBox="0 0 24 24"
		>
			<path d="m6 9 6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
		</svg>
	)
}

/** Opens the controls folded under a project row. */
export function ManageButton({
	open,
	panelId,
	onToggle,
	label = "Manage",
}: Readonly<{ open: boolean; panelId: string; onToggle(): void; label?: string }>) {
	return (
		<Button aria-controls={panelId} aria-expanded={open} onClick={onToggle} type="button">
			{label}
			<ManageChevron open={open} />
		</Button>
	)
}

/** The extra row, under the project, that holds its controls while open. */
export function ManageRow({
	children,
	id,
	open,
	columns = 6,
}: Readonly<{ children: ReactNode; id: string; open: boolean; columns?: number }>) {
	if (!open) return null
	return (
		<tr className="hl-manage-row" id={id}>
			<td colSpan={columns}>
				<div className="hl-manage-panel">{children}</div>
			</td>
		</tr>
	)
}

/** One titled group of controls inside a manage panel. */
export function ManageSection({ children, title }: Readonly<{ children: ReactNode; title: string }>) {
	return (
		<section>
			<h3>{title}</h3>
			{children}
		</section>
	)
}
