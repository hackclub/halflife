"use client"

// biome-ignore lint/correctness/noUndeclaredDependencies: a bundler alias for the vendored file viewer (turbopack.resolveAlias in next.config.ts), not a package
import Hurt from "@review/hurt"
import type { ReactNode } from "react"

/**
 * The Files tab: Fabricate's repository viewer, reading the project's GitHub repo through `/api/reviews/[id]/files`.
 *
 * A default export so the review screen can load it lazily – the viewer and its CAD, PCB and PDF readers are most of the page's weight, and many reviews never open the tab.
 */
export default function FileViewer({ submissionId, tools }: { repo: string; submissionId: string; tools?: ReactNode }) {
	return <Hurt shipId={submissionId} tools={tools} />
}
