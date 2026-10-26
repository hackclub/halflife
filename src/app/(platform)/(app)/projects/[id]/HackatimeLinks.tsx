"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { z } from "zod"
import { IconClock, IconPlus, IconWarning, IconX } from "@/components/platform/icons"
import { Button, inputClass, Panel } from "@/components/platform/ui"
import { linkHackatime } from "@/lib/auth-client"
import { cx } from "@/lib/cx"
import { messageOf } from "@/lib/errors"
import { fmtHours } from "@/lib/projects"
import type { Phase } from "@/lib/types"
import { isRecord } from "@/lib/unknown"

const LinkSchema = z.object({
	hackatimeProject: z.string(),
	hours: z.number(),
	hoursApproved: z.number().nullable(),
	id: z.string(),
	lastFetchError: z.string().nullable(),
	phase: z.enum(["DESIGN", "BUILD"]),
})
type Link = z.infer<typeof LinkSchema>

type Account =
	| { state: "loading" }
	| { state: "unlinked" }
	| { state: "linked"; projects: { name: string; totalSeconds: number }[] }
	| { state: "error" }

const ErrorBodySchema = z.object({
	error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
})
const LinkPageSchema = z.object({ links: z.array(LinkSchema) })
const HackatimeProjectsSchema = z.object({
	projects: z.array(z.object({ name: z.string(), totalSeconds: z.number() })),
})

/** Read the body and turn a refusal into the error the panel shows. */
async function ensureOk(res: Response): Promise<unknown> {
	const body: unknown = await res.json().catch(() => null)
	const envelope = ErrorBodySchema.safeParse(body)
	if (!res.ok)
		throw Object.assign(
			new Error((envelope.success ? envelope.data.error?.message : undefined) ?? "Something went wrong"),
			{ code: envelope.success ? envelope.data.error?.code : undefined },
		)
	return body
}

async function read<S extends z.ZodType>(schema: S, res: Response): Promise<z.infer<S>> {
	const parsed = schema.safeParse(await ensureOk(res))
	if (!parsed.success) throw new Error("The server's answer was not in the expected shape")
	return parsed.data
}

/**
 * Hours that came from the editor rather than the journal.
 *
 * Firmware and CAD scripting are tracked by Hackatime, and a link here is what folds that time into the week – the trail reads it back as off-book hours on the next snapshot, which is why every change ends in a refresh rather than a local patch. The journal is still the evidence; this is only the clock.
 *
 * A link a reviewer has already put hours on cannot be removed: those hours are part of a decision, and the route refuses it, so the button does too.
 */
export function HackatimeLinks({ projectId, phase }: { projectId: string; phase: Phase }) {
	const router = useRouter()
	const [links, setLinks] = useState<Link[] | null>(null)
	const [account, setAccount] = useState<Account>({ state: "loading" })
	const [picked, setPicked] = useState("")
	const [busy, setBusy] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const load = useCallback(async () => {
		try {
			const [linksRes, projectsRes] = await Promise.all([
				fetch(`/api/projects/${projectId}/hackatime`, { cache: "no-store" }),
				fetch("/api/hackatime/projects", { cache: "no-store" }),
			])
			try {
				setLinks((await read(LinkPageSchema, linksRes)).links)
			} catch (err) {
				setError(messageOf(err))
				setLinks([])
			}
			try {
				const { projects } = await read(HackatimeProjectsSchema, projectsRes)
				setAccount({ projects, state: "linked" })
			} catch (err) {
				if (isRecord(err) && err.code === "HACKATIME_NOT_LINKED") setAccount({ state: "unlinked" })
				else {
					setAccount({ projects: [], state: "linked" })
					setError(messageOf(err))
				}
			}
		} catch (err) {
			// The requests never produced a response at all (offline, DNS, abort). Both reads are unusable, so fail visibly with a retry rather than leaving the panel on "checking hackatime…" forever.
			console.error("[hackatime] failed to load links/account:", err)
			setLinks([])
			setAccount({ state: "error" })
			setError("Could not reach Hackatime. Check your connection and try again.")
		}
	}, [projectId])

	/** Retry after a total load failure: show the spinner again, then re-fetch. */
	const retry = useCallback(() => {
		setError(null)
		setLinks(null)
		setAccount({ state: "loading" })
		void load()
	}, [load])

	useEffect(() => {
		// fetching on mount
		void load()
	}, [load])

	async function run(key: string, fn: () => Promise<void>) {
		setBusy(key)
		setError(null)
		try {
			await fn()
			await load()
			router.refresh()
		} catch (err) {
			setError(messageOf(err))
		} finally {
			setBusy(null)
		}
	}

	const link = () =>
		run("link", async () => {
			await ensureOk(
				await fetch(`/api/projects/${projectId}/hackatime`, {
					body: JSON.stringify({
						hackatimeProject: picked,
						phase: phase === "build" ? "BUILD" : "DESIGN",
					}),
					headers: { "content-type": "application/json" },
					method: "POST",
				}),
			)
			setPicked("")
		})

	const unlink = (id: string) =>
		run(id, async () => {
			await ensureOk(await fetch(`/api/projects/${projectId}/hackatime/${id}`, { method: "DELETE" }))
		})

	const linkedNames = new Set(links?.map(l => l.hackatimeProject))
	const available = account.state === "linked" ? account.projects.filter(p => !linkedNames.has(p.name)) : []

	return (
		<>
			<h2 className="label mt-8 mb-3 text-violet-deep">Hackatime</h2>
			<Panel className="bg-paper px-5 py-5 sm:px-6" radius={18} tone="line">
				<p className="max-w-[62ch] text-[0.9rem] leading-snug text-navy-soft">
					Code hours count too: link the Hackatime project you wrote them in.
				</p>

				{error && account.state !== "error" && (
					<p
						className="mt-4 flex items-start gap-2 rounded-xl bg-coral/10 px-3.5 py-2.5 text-[0.85rem] font-semibold text-coral-dark"
						role="alert"
					>
						<IconWarning className="mt-0.5 shrink-0 text-base" /> {error}
					</p>
				)}

				{links === null || account.state === "loading" ? (
					<p aria-live="polite" className="hand mt-4 text-[0.84rem] text-navy-soft">
						checking hackatime…
					</p>
				) : account.state === "error" ? (
					<div className="mt-4 flex flex-wrap items-center gap-3">
						<Button disabled={busy !== null} onClick={retry} variant="outline">
							Try again
						</Button>
						<span className="hand text-[0.84rem] text-coral-deep" role="alert">
							{error ?? "Hackatime could not be loaded."}
						</span>
					</div>
				) : (
					<>
						{links.length > 0 && (
							<ul className="mt-4 grid gap-2">
								{links.map(l => (
									<li
										className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-cream px-3.5 py-2.5"
										key={l.id}
									>
										<span className="min-w-0 flex-1 truncate font-bold text-navy">{l.hackatimeProject}</span>
										<span className="hand inline-flex items-center gap-1.5 text-[0.84rem] text-teal-ink tabular-nums">
											<IconClock className="text-sm" /> {fmtHours(l.hours)}
											{l.hoursApproved !== null && " approved"}
										</span>
										{l.lastFetchError && (
											<span className="hand basis-full text-[0.78rem] text-coral-deep">
												last sync failed, showing the last total we had
											</span>
										)}
										<Button
											aria-label={`Unlink ${l.hackatimeProject}`}
											disabled={busy !== null || l.hoursApproved !== null}
											onClick={() => unlink(l.id)}
											size="sm"
											title={
												l.hoursApproved !== null ? "A reviewer has set hours on this link, so it stays" : undefined
											}
											variant="ghost"
										>
											<IconX className="text-sm" /> {busy === l.id ? "Unlinking…" : "Unlink"}
										</Button>
									</li>
								))}
							</ul>
						)}

						{account.state === "unlinked" ? (
							<div className="mt-4 flex flex-wrap items-center gap-3">
								<Button
									disabled={busy !== null}
									onClick={() =>
										run("account", async () => {
											await linkHackatime(`/projects/${projectId}`)
										})
									}
									variant="teal"
								>
									{busy === "account" ? "Redirecting…" : "Connect Hackatime"}
								</Button>
								<span className="hand text-[0.84rem] text-navy-soft">optional, and only matters for code hours.</span>
							</div>
						) : (
							<div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
								<label className="sr-only" htmlFor={`hackatime-${projectId}`}>
									Hackatime project
								</label>
								<select
									className={cx(inputClass, "min-w-0 flex-1 py-2.5 disabled:text-navy-soft")}
									disabled={available.length === 0 || busy !== null}
									id={`hackatime-${projectId}`}
									onChange={e => setPicked(e.target.value)}
									value={picked}
								>
									<option value="">
										{available.length === 0 ? "No other Hackatime projects yet" : "Pick a Hackatime project…"}
									</option>
									{available.map(p => (
										<option key={p.name} value={p.name}>
											{p.name} · {fmtHours(p.totalSeconds / 3600)}
										</option>
									))}
								</select>
								<Button disabled={!picked || busy !== null} onClick={link} variant="outline">
									<IconPlus className="text-sm" /> {busy === "link" ? "Linking…" : "Link project"}
								</Button>
							</div>
						)}
					</>
				)}
			</Panel>
		</>
	)
}
