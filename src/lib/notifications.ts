import "server-only"
import { Phase, ReviewResult } from "@/app/generated/prisma/enums"
import { AuditAction, logAudit } from "@/lib/audit"
import { getThemeDef } from "@/lib/config/program"
import { sendEmail } from "@/lib/email"
import prisma from "@/lib/prisma"
import { trackSideEffect } from "@/lib/side-effects"
import { postMessage, sendDM } from "@/lib/slack"

/**
 * Telling a maker what a review decided.
 *
 * Best-effort: a decision must never fail because Slack or the mail provider is down, so each channel is attempted independently and a failure becomes a `NOTIFICATION_FAILURE` audit row rather than an error. The in-app project page is still the source of truth, so a missed message is inconvenient, not lost.
 *
 * Called after the decision transaction has committed, from both decision paths (the console route and the Ari webhook), so the two cannot drift.
 */

export interface ReviewOutcomeNotice {
	themeProjectId: string
	phase: Phase
	result: ReviewResult
	/**
	 * The reviewer's note to the maker, or null when there was none.
	 *
	 * Null is ordinary rather than exceptional: Ari decides without a note often enough that substituting its generic fallback would put "Reviewer's note: Ari asked for changes before this can be approved." into a maker's DM – a line that says the same thing twice and tells them nothing they can act on. The project page keeps whatever the review itself recorded; this is only what goes in the message.
	 */
	note: string | null
	/** Which surface decided it, so the message can say who is asking. */
	decidedBy: "ari" | "console"
}

function projectUrl(id: string): string | null {
	const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "")
	return base ? `${base}/projects/${id}` : null
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
/** The note is participant/reviewer text, so it never lands in HTML unescaped. */
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c)

/**
 * Who to name, on the one outcome where the answer matters.
 *
 * A returned submission is a request to do something, so the maker needs to know who is asking. Ari is the bot. A console decision was made by a volunteer, and this deliberately does not name them: a reviewer's address has no business in a participant's DM, and the project page already shows the review it came from.
 */
function asker(decidedBy: "ari" | "console"): string {
	return decidedBy === "ari" ? "Ari" : "A Half Life reviewer"
}

/** One line per outcome, in the voice the platform uses everywhere else. */
function headline(
	result: ReviewResult,
	phase: string,
	title: string,
	decidedBy: "ari" | "console",
): { subject: string; body: string; next?: string } {
	const what = `${phase} for ${title}`
	switch (result) {
		case ReviewResult.APPROVED:
			return { subject: `Your ${phase} was approved – ${title}`, body: `Good news: your ${what} was approved.` }
		case ReviewResult.RETURNED:
			return {
				subject: `Changes requested on your ${phase} – ${title}`,
				body: `${asker(decidedBy)} asked for changes on your ${what}.`,
				// The half that makes it actionable. What the status now permits is more work rather than less, and without this line the message reads as a verdict while the trail's own wording does the explaining somewhere a maker may never look.
				next: "Fix it and hand it in again from the project page – your week still takes submissions until it closes.",
			}
		case ReviewResult.REJECTED:
			return { subject: `Your ${phase} was not approved – ${title}`, body: `Your ${what} was not approved.` }
		default:
			return { subject: `An update on your ${phase} – ${title}`, body: `There is an update on your ${what}.` }
	}
}

/**
 * The message a decision produces, as pure data.
 *
 * Separated from the sending so that what a maker is actually told can be read, and checked, without a Slack call: the words are the part that is easy to get wrong and the part nobody notices until a participant is confused by one.
 */
export function reviewOutcomeMessage(
	notice: Pick<ReviewOutcomeNotice, "result" | "decidedBy" | "note">,
	context: { phase: Phase; title: string },
): { subject: string; lines: string[] } {
	const phaseLabel = context.phase === Phase.DESIGN ? "design" : "build"
	const { subject, body, next } = headline(notice.result, phaseLabel, context.title, notice.decidedBy)
	const note = notice.note?.trim() || ""
	return { subject, lines: [body, ...(next ? [next] : []), ...(note ? [note] : [])] }
}

/**
 * Tell the maker, whatever happens.
 *
 * Nothing in here may reach the caller, and on the Ari path that is load-bearing rather than tidiness. This runs inside the webhook handler, so a throw becomes a 5xx, Ari redelivers, and the redelivery finds the decision already committed – recorded as "already resolved" and swallowed. The maker would then be told nothing at all, with no record that a notification was owed, which is the single outcome this module exists to prevent. So a failure here is caught and written down, where an admin can see that somebody needs chasing.
 */
export async function notifyReviewOutcome(notice: ReviewOutcomeNotice): Promise<void> {
	try {
		await deliverReviewOutcome(notice)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		console.error(`[notifications] review outcome notice failed for ${notice.themeProjectId}:`, err)
		await logAudit({
			action: AuditAction.NOTIFICATION_FAILURE,
			targetType: "ThemeProject",
			targetId: notice.themeProjectId,
			metadata: {
				kind: "review_outcome",
				phase: notice.phase,
				result: notice.result,
				decidedBy: notice.decidedBy,
				// Which half of the send gave up. The channels record their own; this is everything before them, which is exactly the part nothing else watches.
				stage: "before_channels",
				error: message,
			},
		}).catch(() => undefined)
	}
}

async function deliverReviewOutcome(notice: ReviewOutcomeNotice): Promise<void> {
	const project = await prisma.themeProject.findUnique({
		where: { id: notice.themeProjectId },
		select: {
			title: true,
			theme: true,
			user: { select: { name: true, email: true, slackId: true } },
		},
	})
	if (!project) return

	const { email, slackId } = project.user
	const title = project.title.trim() || getThemeDef(project.theme).label
	const { subject, lines } = reviewOutcomeMessage(notice, { phase: notice.phase, title })
	const url = projectUrl(notice.themeProjectId)
	const firstName = project.user.name?.trim().split(/\s+/)[0] || "there"

	const ctx = {
		actorId: null,
		targetType: "ThemeProject",
		targetId: notice.themeProjectId,
		metadata: { kind: "review_outcome", phase: notice.phase, result: notice.result, decidedBy: notice.decidedBy },
	}

	if (slackId) {
		const link = url ? `\n<${url}|Open the project>` : ""
		await trackSideEffect("slack", ctx, () => sendDM(slackId, `${lines.join("\n\n")}${link}`))
	}

	if (email) {
		const text = [
			`Hi ${firstName},`,
			"",
			...lines,
			...(url ? ["", `Open the project: ${url}`] : []),
			"",
			"– Half Life",
		].join("\n")

		const html = [
			`<div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#262a2d">`,
			`<p>Hi ${escapeHtml(firstName)},</p>`,
			...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
			url ? `<p><a href="${url}" style="color:#2e8cae">Open the project</a></p>` : "",
			`<p style="color:#4a4785">– Half Life</p>`,
			"</div>",
		]
			.filter(Boolean)
			.join("\n")

		await trackSideEffect("email", ctx, () => sendEmail({ to: email, subject, text, html }))
	}
}

/**
 * Ask staff to look again at a decision a maker has disputed.
 *
 * Posted to `SLACK_REVIEW_CHANNEL_ID` when it is set. A deployment without it still has the dispute in the console and the audit log, so nothing is lost.
 */
export async function notifyStaffDispute(input: {
	themeProjectId: string
	title: string
	phase: Phase
	note: string
	participant: string
}): Promise<void> {
	const channel = process.env.SLACK_REVIEW_CHANNEL_ID
	if (!channel) return
	const phase = input.phase === Phase.DESIGN ? "design" : "build"
	const url = projectUrl(input.themeProjectId)
	const quoted = input.note
		.trim()
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n")
	const text = `Review dispute on *${input.title}* (${phase}) by ${input.participant}:\n\n${quoted}${
		url ? `\n\n<${url}|Open the project>` : ""
	}`
	await trackSideEffect(
		"slack",
		{ actorId: null, targetType: "ThemeProject", targetId: input.themeProjectId, metadata: { kind: "review_dispute" } },
		() => postMessage(channel, text),
	)
}
