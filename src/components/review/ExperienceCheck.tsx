"use client"

import { type ReactNode, useEffect, useState } from "react"
import { request } from "@/components/review/api"
import { Paper, SafeLink, StatusTag } from "@/components/review/ui"
import type { ExperienceData, ExperienceCheck as Result } from "@/lib/experience-check"

const LEVELS: { [_: string]: string } = {
	beginner: "Beginner",
	experienced: "Experienced",
	intermediate: "Intermediate",
	none: "No earlier hardware",
}

const TITLE = "Earlier hardware on GitHub"

/**
 * Fabricate's `ExperienceCheckCard`: Claude's summary of the maker's earlier hardware work on GitHub. Evidence for the reviewer, never a decision.
 *
 * Asked for once the screen has loaded (see `/api/reviews/[id]/experience`), so the rest of the page, and every `router.refresh()` it runs, never waits on GitHub or Claude.
 */
export function ExperienceCheck({ shipId }: { shipId: string }) {
	const [result, setResult] = useState<Result | { kind: "loading" }>({ kind: "loading" })
	useEffect(() => {
		let live = true
		async function load(): Promise<void> {
			let next: Result
			try {
				next = await request<Result>(`/api/reviews/${encodeURIComponent(shipId)}/experience`, { method: "GET" })
			} catch (err) {
				next = { kind: "error", message: err instanceof Error ? err.message : "Something went wrong." }
			}
			if (live) setResult(next)
		}
		void load()
		return () => {
			live = false
		}
	}, [shipId])

	if (result.kind === "loading")
		return (
			<Paper title={TITLE}>
				<p className="field__hint">Reading the maker&rsquo;s GitHub…</p>
			</Paper>
		)
	if (result.kind === "off")
		return (
			<Paper title={TITLE}>
				<p className="field__hint">Experience check is off. Set ANTHROPIC_API_KEY to turn it on.</p>
			</Paper>
		)
	if (result.kind === "no-repo")
		return (
			<Paper title={TITLE}>
				<p className="field__hint">This project has no GitHub repo, so there&rsquo;s no account to read.</p>
			</Paper>
		)
	if (result.kind === "error")
		return (
			<Paper title={TITLE}>
				<p className="field__error" role="alert">
					Couldn&rsquo;t check the maker&rsquo;s GitHub: {result.message}
				</p>
			</Paper>
		)
	const { check, checkedAt } = result
	return (
		<Paper meta={meta(check)} title={TITLE}>
			<div className="paper-stack" style={{ gap: "var(--space-1)" }}>
				{check.skipped === "no_account" ? (
					<p className="field__hint">
						This repo, and any other Half Life repos of the maker&rsquo;s, belong to organisations, and the repo&rsquo;s
						top committer isn&rsquo;t a personal account, so there&rsquo;s no profile to read.
					</p>
				) : null}
				{check.skipped === "no_hardware" ? (
					<p className="field__hint">
						None of the {check.repoCount} other repos looks like hardware from its name, description and language, or
						from the files of the {check.scannedCount} likeliest.
					</p>
				) : null}
				{check.level ? (
					<p>
						<StatusTag label={LEVELS[check.level] ?? check.level} status="draft" />
						{check.levelEvidence ? <span className="field__hint"> {check.levelEvidence}</span> : null}
					</p>
				) : null}
				{check.summary ? <p>{check.summary}</p> : null}
				{check.concerns?.length ? (
					<ul className="notes-list">
						{check.concerns.map(c => (
							<li key={`${c.repo}:${c.concern}`}>
								<StatusTag label="Look at" status="returned" /> <SafeLink href={c.url}>{c.repo}</SafeLink>: {c.concern}
								{c.evidence ? <span className="field__hint"> · {c.evidence}</span> : null}
							</li>
						))}
					</ul>
				) : null}
				{check.projects?.length ? (
					<ul className="notes-list">
						{check.projects.map(p => (
							<li key={p.repo}>
								<SafeLink href={p.url}>{p.repo}</SafeLink>: {p.what}
								{files(check, p.repo)}
								{p.evidence ? <span className="field__hint"> · {p.evidence}</span> : null}
							</li>
						))}
					</ul>
				) : null}
				{check.tools?.length ? <p className="field__hint">Tools seen: {check.tools.join(", ")}</p> : null}
				<p className="field__hint">
					{check.skipped
						? `Checked ${checkedAt.slice(0, 10)}, without Claude.`
						: `Read by Claude ${checkedAt.slice(0, 10)}. Evidence for you, not a decision.`}
				</p>
			</div>
		</Paper>
	)
}

function meta(check: ExperienceData): ReactNode {
	if (!check.login) return null
	return (
		<>
			<SafeLink href={`https://github.com/${check.login}`}>{check.login}</SafeLink>
			{check.loginSource === "committer" ? " (top committer, the repo belongs to an organisation)" : ""} ·{" "}
			{check.repoCount} other repos · {check.repos.length} look like hardware
		</>
	)
}

function files(check: ExperienceData, name: string): ReactNode {
	const repo = check.repos.find(r => r.fullName === name)
	if (!repo) return null
	return [...repo.files.map(([label, count]) => `${count} ${label}`), `${repo.createdAt} to ${repo.pushedAt}`].map(
		chip => (
			<span className="field__hint" key={chip}>
				{" · "}
				<span style={{ whiteSpace: "nowrap" }}>{chip}</span>
			</span>
		),
	)
}
