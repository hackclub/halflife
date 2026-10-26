"use client"
import { useState } from "react"
import { Button, Callout } from "@/app/components/ui"
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
			<p className="hl-hint" style={{ margin: 0 }}>
				{onRecord.banned
					? `Banned since ${new Date(onRecord.bannedAt ?? "").toLocaleString()}`
					: onRecord.suspended && onRecord.suspendedUntil
						? `Suspended until ${new Date(onRecord.suspendedUntil).toLocaleString()}`
						: "No penalty on record"}
			</p>
			{!onRecord.banReason && !onRecord.suspensionReason ? null : (
				<p className="hl-hint" style={{ margin: 0 }}>
					Reason: {onRecord.banReason ?? onRecord.suspensionReason}
				</p>
			)}

			{onRecord.banned ? (
				<div className="hl-row">
					<Button
						disabled={busy === "UNBAN"}
						onClick={() => apply("UNBAN", { restoreContent })}
						type="button"
					>
						Lift ban
					</Button>
					{onRecord.rollbackContentHidden ? (
						<label className="hl-row" style={{ alignItems: "center", gap: "0.4rem" }}>
							<input
								checked={restoreContent}
								onChange={e => setRestoreContent(e.target.checked)}
								type="checkbox"
							/>
							restore the reels and comments this ban hid
						</label>
					) : null}
				</div>
			) : onRecord.suspended ? (
				<Button
					disabled={busy === "UNSUSPEND"}
					onClick={() => apply("UNSUSPEND")}
					type="button"
				>
					Lift suspension
				</Button>
			) : null}

			{!onRecord.banned ? (
				<form className="hl-stack hl-stack--tight" onSubmit={e => { e.preventDefault(); handDown() }}>
					<textarea
						aria-label="Penalty reason"
						className="hl-input"
						onChange={e => setReason(e.target.value)}
						placeholder="Why - it goes to the audit trail and the member's record"
						required
						rows={2}
					/>
					<div className="hl-row">
						<input
							aria-label="Suspend until"
							className="hl-input"
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
							<input
								checked={hideContent}
								onChange={e => setHideContent(e.target.checked)}
								type="checkbox"
							/>
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
