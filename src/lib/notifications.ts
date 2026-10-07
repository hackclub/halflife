import "server-only"
import { Phase, ReviewResult } from "@/app/generated/prisma/enums"
import { getThemeDef } from "@/lib/config/program"
import { sendEmail } from "@/lib/email"
import prisma from "@/lib/prisma"
import { trackSideEffect } from "@/lib/side-effects"
import { postMessage, sendDM } from "@/lib/slack"

/**
 * Telling a maker what a review decided.
 *
 * Best-effort: a decision must never fail because Slack or the mail provider
 * is down, so each channel is attempted independently and a failure becomes a
 * `NOTIFICATION_FAILURE` audit row rather than an error. The in-app project
 * page is still the source of truth, so a missed message is inconvenient, not
 * lost.
 *
 * Called after the decision transaction has committed, from both decision
 * paths (the console route and the Ari webhook), so the two cannot drift.
 */

export interface ReviewOutcomeNotice {
	themeProjectId: string
	phase: Phase
	result: ReviewResult
	/** The reviewer's note, which the participant is meant to read. */
	feedback: string
}

function projectUrl(id: string): string | null {
	const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "")
	return base ? `${base}/projects/${id}` : null
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
/** The note is participant/reviewer text, so it never lands in HTML unescaped. */
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c)

/** One line per outcome, in the voice the platform uses everywhere else. */
function headline(result: ReviewResult, phase: string, title: string): { subject: string; body: string } {
	const what = `${phase} for ${title}`
	switch (result) {
		case ReviewResult.APPROVED:
			return { subject: `Your ${phase} was approved – ${title}`, body: `Good news: your ${what} was approved.` }
		case ReviewResult.RETURNED:
			return {
				subject: `Changes requested on your ${phase} – ${title}`,
				body: `Your ${what} needs a few changes before it can be approved.`,
			}
		case ReviewResult.REJECTED:
			return { subject: `Your ${phase} was not approved – ${title}`, body: `Your ${what} was not approved.` }
		default:
			return { subject: `An update on your ${phase} – ${title}`, body: `There is an update on your ${what}.` }
	}
}

export async function notifyReviewOutcome(notice: ReviewOutcomeNotice): Promise<void> {
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
	const phaseLabel = notice.phase === Phase.DESIGN ? "design" : "build"
	const { subject, body } = headline(notice.result, phaseLabel, title)
	const url = projectUrl(notice.themeProjectId)
	const feedback = notice.feedback.trim()
	const firstName = project.user.name?.trim().split(/\s+/)[0] || "there"

	const ctx = {
		actorId: null,
		targetType: "ThemeProject",
		targetId: notice.themeProjectId,
		metadata: { kind: "review_outcome", phase: notice.phase, result: notice.result },
	}

	if (slackId) {
		const link = url ? `\n<${url}|Open the project>` : ""
		const dm = `${body}${feedback ? `\n\nReviewer's note: ${feedback}` : ""}${link}`
		await trackSideEffect("slack", ctx, () => sendDM(slackId, dm))
	}

	if (email) {
		const text = [
			`Hi ${firstName},`,
			"",
			body,
			...(feedback ? ["", `Reviewer's note: ${feedback}`] : []),
			...(url ? ["", `Open the project: ${url}`] : []),
			"",
			"– Half Life",
		].join("\n")

		const html = [
			`<div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#262a2d">`,
			`<p>Hi ${escapeHtml(firstName)},</p>`,
			`<p>${escapeHtml(body)}</p>`,
			feedback
				? `<blockquote style="margin:1rem 0;padding:.5rem 1rem;border-left:3px solid #c8c3d6;color:#4a4785">${escapeHtml(feedback)}</blockquote>`
				: "",
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
 * Posted to `SLACK_REVIEW_CHANNEL_ID` when it is set. A deployment without it
 * still has the dispute in the console and the audit log, so nothing is lost.
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
