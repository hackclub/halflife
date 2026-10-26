"use client"

import { useCallback, useEffect, useState } from "react"
import { z } from "zod"
import { IconCheck, IconWarning } from "@/components/platform/icons"
import { RepoEditor } from "@/components/platform/RepoField"
import { Button } from "@/components/platform/ui"
import { cx } from "@/lib/cx"
import { messageOf } from "@/lib/errors"
import { displayRepo } from "@/lib/repo"
import type { RepoCheck, RepoCheckResult } from "@/lib/repo-checks"
import { useStore } from "@/lib/store"
import type { Project } from "@/lib/types"
import { isRecord } from "@/lib/unknown"

const RepoCheckSchema = z.object({
	blocking: z.boolean().optional(),
	detail: z.string().optional(),
	key: z.string(),
	label: z.string(),
	link: z.object({ href: z.string(), label: z.string() }).optional(),
	status: z.enum(["pass", "fail", "warn"]),
})

const RepoCheckResultSchema = z.object({
	canSubmit: z.boolean(),
	checkedAt: z.string(),
	checks: z.array(RepoCheckSchema),
	repo: z.string().nullable(),
	unavailable: z.boolean(),
})

const RepoCheckResponseSchema = RepoCheckResultSchema.extend({
	error: z.object({ message: z.string().optional() }).optional(),
})

/**
 * What the repo has, checked against what this week needs – before the maker hands it in rather than after a reviewer bounces it.
 *
 * Failures that block are coral and say how to fix them; recommendations are amber and never block; GitHub being unreachable is amber too, because that is ours to absorb. The repo being checked sits under the heading with its editor, so a wrong or missing link is fixed without leaving the sheet, and a new link re-runs the checks. Otherwise the fix is a push, and "Check again" is how the sheet finds out.
 */
export function RepoChecks({
	project,
	onResult,
	editable = true,
	syncRepo: initialSyncRepo,
}: {
	project: Project
	onResult(result: RepoCheckResult | null): void
	/**
	 * Whether the link can be changed from here. The submit sheet says yes, so a wrong link is fixed without leaving it; the project page says no, because its own details editor already owns the link.
	 */
	editable?: boolean
	/**
	 * The sync target the page already loaded, when it has one. Passing it – even as null – skips the second read of an endpoint the server render has already answered; omitting it makes the sheet load the shortcut for itself.
	 */
	syncRepo?: { repo: string; differs: boolean } | null
}) {
	const { linkSyncRepoToProject } = useStore()
	const [data, setData] = useState<RepoCheckResult | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	// Whether the sync writes to a different repo than the project links to, and what that repo is – the shortcut offered when the link is missing or wrong.
	const [syncRepo, setSyncRepo] = useState<{ repo: string; differs: boolean } | null>(initialSyncRepo ?? null)
	const [linking, setLinking] = useState(false)

	// Runs on mount and on a new link. The sync state is a second read, and only its repo identity is kept: the rest of it belongs to the sync settings box.
	const loadSync = useCallback(async () => {
		try {
			const res = await fetch(`/api/projects/${project.id}/repo-sync`, { cache: "no-store" })
			if (!res.ok) return
			const body: unknown = await res.json()
			if (!isRecord(body)) return
			const { repo, syncRepoDiffers } = body
			setSyncRepo(typeof repo === "string" && syncRepoDiffers === true ? { differs: true, repo } : null)
		} catch {
			// Best effort: the shortcut is a convenience, not the check itself.
		}
	}, [project.id])

	useEffect(() => {
		// The page already loaded the sync state; only a surface without it asks.
		if (initialSyncRepo !== undefined) return
		void loadSync()
	}, [initialSyncRepo, loadSync])

	async function linkProject() {
		if (!syncRepo) return
		setLinking(true)
		setError(null)
		const refused = await linkSyncRepoToProject(project.id)
		setLinking(false)
		if (refused) setError(refused)
		else setSyncRepo(null)
	}

	const run = useCallback(async () => {
		setLoading(true)
		setError(null)
		onResult(null)
		try {
			const res = await fetch(`/api/projects/${project.id}/preflight`, { cache: "no-store" })
			const parsed = RepoCheckResponseSchema.safeParse(await res.json().catch(() => null))
			if (!res.ok)
				throw new Error((parsed.success ? parsed.data.error?.message : undefined) ?? "Could not check the repo")
			if (!parsed.success) throw new Error("Could not check the repo")
			setData(parsed.data)
			onResult(parsed.data)
		} catch (err) {
			setError(messageOf(err))
		} finally {
			setLoading(false)
		}
		// The link is the input: a new one means a fresh check.
	}, [project.id, project.githubRepo])

	useEffect(() => {
		// fetching on mount and on a new link
		void run()
	}, [run])

	const blocking = data?.checks.filter(c => c.blocking && c.status === "fail").length ?? 0

	return (
		<section
			aria-labelledby="repo-checks-title"
			className="sketch mb-5 rounded-2xl bg-white px-4 py-4 sm:px-5"
			style={{ "--sk-radius": "16px" }}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="label text-violet-deep" id="repo-checks-title">
					Repo checks
				</h3>
				<Button disabled={loading} onClick={() => run()} size="sm" variant="ghost">
					{loading ? "Checking…" : "Check again"}
				</Button>
			</div>
			{/* Where the link can be changed, it sits here with its editor. Where it cannot – the project page – it is already in the page's heading, and saying it twice a few lines apart only makes the reader compare them. */}
			{editable && <RepoEditor className="mt-1" project={project} />}

			{/* The sync can be pointed at a repo the project link never got, which is exactly the state the checks below fail in. One press copies it over, so the fix for a "No repo" finding is here rather than a trip to the details form. */}
			{syncRepo && (
				<p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl bg-gold-pale/60 px-3.5 py-2.5 text-[0.85rem] leading-relaxed text-navy">
					<span>
						Your repo sync is writing to <span className="font-semibold">{displayRepo(syncRepo.repo)}</span>. Link this
						project to it?
					</span>
					<Button disabled={linking} onClick={() => linkProject()} size="sm" variant="outline">
						{linking ? "Linking…" : "Link this repo"}
					</Button>
				</p>
			)}

			{loading && !data ? (
				<p aria-live="polite" className="hand mt-2 text-[0.84rem] text-navy-soft">
					reading your repo on GitHub…
				</p>
			) : error ? (
				<p className="mt-2 text-[0.85rem] font-semibold text-coral-deep" role="alert">
					{error}
				</p>
			) : data ? (
				<>
					<p aria-live="polite" className="mt-1 text-[0.9rem] leading-snug text-navy-soft">
						{blocking > 0
							? `${blocking} ${blocking === 1 ? "thing needs" : "things need"} fixing before you can submit.`
							: data.unavailable
								? "GitHub could not be reached, so this was not checked. You can still submit."
								: "Everything this week needs is in the repo."}
					</p>
					<ul className={cx("mt-3 grid gap-1.5", loading && "opacity-60")}>
						{data.checks.map(c => (
							<CheckRow check={c} key={c.key} />
						))}
					</ul>
				</>
			) : null}
		</section>
	)
}

function CheckRow({ check }: { check: RepoCheck }) {
	const tone =
		check.status === "pass" ? "text-teal-ink" : check.status === "fail" ? "text-coral-deep" : "text-orange-ink"
	return (
		<li className="flex items-start gap-2.5">
			<span
				aria-hidden="true"
				className={cx(
					"mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
					check.status === "pass" ? "bg-mint" : check.status === "fail" ? "bg-coral/15" : "bg-gold-pale",
					tone,
				)}
			>
				{check.status === "pass" ? (
					<IconCheck className="text-[0.7rem]" strokeWidth={3.4} />
				) : (
					<IconWarning className="text-[0.75rem]" />
				)}
			</span>
			<span className="min-w-0 flex-1">
				<span className={cx("block text-[0.9rem] font-bold", check.status === "pass" ? "text-navy" : tone)}>
					{check.label}
					<span className="sr-only">
						{check.status === "pass" ? " (passed)" : check.blocking ? " (required)" : " (recommended)"}
					</span>
				</span>
				{check.detail && (
					<span className="block text-[0.8rem] leading-snug [overflow-wrap:anywhere] text-navy-soft">
						{check.detail}
					</span>
				)}
				{check.link && (
					<a
						className="mt-1 inline-flex items-center gap-1 text-[0.8rem] font-semibold text-sky-ink underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
						href={check.link.href}
						rel="noopener noreferrer"
						target="_blank"
					>
						{check.link.label}
					</a>
				)}
			</span>
		</li>
	)
}
