"use client"
import { useState } from "react"
import { Button, Callout, TextArea, TextInput } from "@/app/components/ui"
import { sendJson, useAction } from "@/lib/use-action"

/** The penalty state as the server page read it, with instants already converted to ISO. */
export interface PenaltySnapshot {
	banned: boolean
	bannedAt: string | null
	banReason: string | null
	/** True when some content on record carries the ban's own stamp (`hiddenByBanAt`), so unbanning may offer to restore it. */
	rollbackContentHidden: boolean
	suspended: boolean
	suspendedUntil: string | null
	suspensionReason: string | null
}

/**
 * The card that hands a penalty down, and lifts one.
 *
 * Both live on one card because each action needs to know the other's state: a member under a ban cannot be suspended, and unbanning must ask what to do with the reels the ban hid. Free-text reason is required for anything applied - it is the audit trail's answer to "why is this member gone".
 */
export function PenaltyCard({ url, ...onRecord }: Readonly<PenaltySnapshot & { url: string }>) {
	const { busy, error, run, setError } = useAction()

	const [reason, setReason] = useState("")
	const [until, setUntil] = useState("")
	const [hideContent, setHideContent] = useState(true)
	const [restoreContent, setRestoreContent] = useState(true)

	// The reason on the row belongs to whichever penalty is on. An expired suspension keeps its own reason until cleared, so reading it on "no penalty" would show a note with nothing behind it.
	const activeReason = onRecord.banned ? onRecord.banReason : onRecord.suspended ? onRecord.suspensionReason : null

	function apply(action: string, extra?: object) {
		void run(action, () => sendJson(url, { body: { action, ...extra }, method: "POST" }))
	}

	function handDown() {
		if (!reason.trim()) {
			setError("A reason is required")
			return
		}
		if (until) apply("SUSPEND", { reason, until: new Date(until).toISOString() })
		else apply("BAN", { hideContent, reason })
	}

	return (
		<div className="hl-stack hl-stack--tight">
			<p className="hl-hint" style={{ margin: 0 }} suppressHydrationWarning>
				{onRecord.banned
					? `Banned since ${new Date(onRecord.bannedAt ?? "").toLocaleString()}`
					: onRecord.suspended && onRecord.suspendedUntil
						? `Suspended until ${new Date(onRecord.suspendedUntil).toLocaleString()}`
						: "No penalty on record"}
			</p>
			{activeReason ? (
				<p className="hl-hint" style={{ margin: 0 }}>
					Reason: {activeReason}
				</p>
			) : null}

			{onRecord.banned ? (
				<div className="hl-row">
					<Button disabled={busy !== null} onClick={() => apply("UNBAN", { restoreContent })} type="button">
						Lift ban
					</Button>
					{onRecord.rollbackContentHidden ? (
						<label className="hl-row" style={{ alignItems: "center", gap: "0.4rem" }}>
							<input checked={restoreContent} onChange={e => setRestoreContent(e.target.checked)} type="checkbox" />
							restore the reels and comments this ban hid
						</label>
					) : null}
				</div>
			) : onRecord.suspended ? (
				<Button disabled={busy !== null} onClick={() => apply("UNSUSPEND")} type="button">
					Lift suspension
				</Button>
			) : null}

			{!onRecord.banned ? (
				<form
					className="hl-stack hl-stack--tight"
					onSubmit={e => {
						e.preventDefault()
						handDown()
					}}
				>
					<TextArea
						aria-label="Penalty reason"
						onChange={e => setReason(e.target.value)}
						placeholder="Why - it goes to the audit trail and the member's record"
						required
						rows={2}
					/>
					<div className="hl-row">
						<TextInput
							aria-label="Suspend until"
							onChange={e => setUntil(e.target.value)}
							style={{ maxWidth: "14rem" }}
							type="datetime-local"
						/>
						{until ? (
							<Button disabled={busy !== null} type="submit">
								Suspend
							</Button>
						) : (
							<Button disabled={busy !== null} type="submit" variant="danger">
								Ban
							</Button>
						)}
					</div>
					{until ? null : (
						<label className="hl-row" style={{ alignItems: "center", gap: "0.4rem" }}>
							<input checked={hideContent} onChange={e => setHideContent(e.target.checked)} type="checkbox" />
							also hide all of their public reels and comments
						</label>
					)}
					<p className="hl-hint" style={{ margin: 0 }}>
						{until
							? "Suspended: they keep signing in and reading, but cannot post, comment, like, log work or spend."
							: "Banned: sign-in refused and sessions revoked immediately. Hidden content comes back on unban if you restore it."}
					</p>
				</form>
			) : null}
			{error ? <Callout tone="danger">{error}</Callout> : null}
		</div>
	)
}
