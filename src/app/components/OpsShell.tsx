import type { ReactNode } from "react"

/**
 * The frame around every ops screen: the nav along the top, the signed-in address pinned right, and the shell around the page.
 *
 * Admin and review each supply their own links; the nav itself, the address and the main column are the same on both.
 */
export function OpsShell({
	children,
	email,
	nav,
	title,
}: Readonly<{ children: ReactNode; email: string; nav: ReactNode; title: string }>) {
	return (
		<>
			<nav className="hl-nav">
				<strong>{title}</strong>
				{nav}
				<span className="hl-muted" style={{ marginLeft: "auto" }}>
					{email}
				</span>
			</nav>
			<main className="hl-shell">{children}</main>
		</>
	)
}
