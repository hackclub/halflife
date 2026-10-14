import "server-only"
import type { Prisma } from "@/app/generated/prisma/client"
import { Phase, ReviewResult } from "@/app/generated/prisma/enums"
import { AuditAction, logAudit } from "@/lib/audit"
import { projectDisplayTitle } from "@/lib/config/program"
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

export interface ReviewOutcomeMessage {
	subject: string
	/** Our words, in order. The reviewer's note is deliberately not among them. */
	prose: string[]
	/**
	 * The reviewer's own words, or null.
	 *
	 * Kept as its own field rather than a paragraph among the rest, because it is the one part a human typed and the only part with line breaks worth keeping. An email that folds it into a `<p>` collapses every newline into a space, which is how a note that asked for three separate things arrives as one sentence.
	 */
	note: string | null
}

/**
 * The message a decision produces, as pure data.
 *
 * Separated from the sending so that what a maker is actually told can be read, and checked, without a Slack call: the words are the part that is easy to get wrong and the part nobody notices until a participant is confused by one.
 */
export function reviewOutcomeMessage(
	notice: Pick<ReviewOutcomeNotice, "result" | "decidedBy" | "note">,
	context: { phase: Phase; title: string },
): ReviewOutcomeMessage {
	const phaseLabel = context.phase === Phase.DESIGN ? "design" : "build"
	const { subject, body, next } = headline(notice.result, phaseLabel, context.title, notice.decidedBy)
	const note = notice.note?.trim() || ""
	return { subject, prose: [body, ...(next ? [next] : [])], note: note || null }
}

/**
 * The message for a hand-in that never reached review.
 *
 * Deliberately not built from a review outcome: nothing has been reviewed, so there is no verdict to report and no reviewer to name. Calling this "changes requested" would describe a decision nobody made.
 *
 * The reason is the send's own refusal rather than a person's note, so it reads as one of our paragraphs instead of the boxed quote a reviewer's words get. That also means it can change between attempts as the maker edits - only the project page follows it, because the notice itself is owed once.
 */
export function shipFailedMessage(source: { title: string; phase: Phase; reason: string }): {
	subject: string
	prose: string[]
} {
	const phase = source.phase === Phase.DESIGN ? "design" : "build"
	return {
		subject: `Your ${phase} for ${source.title} has not reached review`,
		prose: [
			`Your ${phase} for ${source.title} was handed in, but it could not be sent for review, so nothing has been reviewed yet.`,
			source.reason,
			"Fix that on the project page, then hand it in again – if the week still shows as in review, take it back first.",
		],
	}
}

/**
 * The message as flat paragraphs, in the one order every plain-text channel wants.
 *
 * Ours first and the reviewer's last, so the note lands under the line that explains it. One definition instead of each caller reassembling the message, because the order is part of what the note means.
 */
function plainLines(message: { prose: readonly string[]; note: string | null }): string[] {
	return [...message.prose, ...(message.note ? [message.note] : [])]
}

/**
 * The colour a decision wears, in the platform's own state inks.
 *
 * Orange for a phase sent back for changes and coral for one rejected, matching `lib/review-state.ts`; teal for an approval, which reaches the same mailer. The ink tones rather than the fills, because both places this goes are small text on white.
 */
function reviewInk(result: ReviewResult): string {
	if (result === ReviewResult.REJECTED) return "#a53131"
	if (result === ReviewResult.APPROVED) return "#037365"
	return "#8c5507"
}

const EMAIL_FONT = "font-family:system-ui,-apple-system,'Segoe UI',sans-serif"

/**
 * The email body for a notice to a maker.
 *
 * Tables with inline styles, because there is nothing a mail client could load: no stylesheet, and so no flexbox or grid either. Colours are platform tokens from DESIGN.md, so the mail reads as the same place the trail does.
 *
 * The note is the only thing in here that is not a paragraph. It keeps its whitespace and gets a tinted box with the notice's own colour on its edge, set apart from our prose so a maker can tell whose words they are reading – the treatment the project page already gives a review comment (Timeline.tsx). A notice whose reason is ours rather than a person's passes none, and says it in `prose` instead.
 */
function emailHtml(input: {
	greeting: string
	/** The body, in order. The first line is set as the headline. */
	prose: readonly string[]
	/** A reviewer's own words, boxed and labelled, or null when nobody typed any. */
	note: string | null
	/** The accent for the note's box and its rule. Unused when there is no note to draw one around. */
	ink?: string
	url: string | null
}): string {
	const ink = input.ink ?? "#4a4785"
	const headline = input.prose[0] ?? ""
	const rest = input.prose.slice(1)
	const note = input.note
		? `<div style="margin-top:8px;border-left:3px solid ${ink};border-radius:0 8px 8px 0;background-color:#f4f4f8;padding:14px 16px;${EMAIL_FONT};font-size:15px;line-height:1.6;color:#1c1a59;white-space:pre-line;overflow-wrap:anywhere">${escapeHtml(input.note)}</div>`
		: ""

	return [
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fcf7f7" style="background-color:#fcf7f7;border-collapse:collapse">`,
		`<tr><td align="center" style="padding:32px 16px">`,
		`<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:560px;max-width:100%;background-color:#ffffff;border-radius:16px">`,
		`<tr><td style="padding:28px 32px 0;${EMAIL_FONT};font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#4a4785">Half Life</td></tr>`,
		`<tr><td style="padding:14px 32px 0;${EMAIL_FONT};font-size:15px;line-height:1.6;color:#1c1a59">${input.greeting}</td></tr>`,
		`<tr><td style="padding:6px 32px 0;${EMAIL_FONT};font-size:22px;font-weight:800;line-height:1.3;color:#1c1a59">${escapeHtml(headline)}</td></tr>`,
		note
			? `<tr><td style="padding:20px 32px 0"><div style="${EMAIL_FONT};font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#4a4785">From your reviewer</div>${note}</td></tr>`
			: "",
		...rest.map(
			(line) =>
				`<tr><td style="padding:12px 32px 0;${EMAIL_FONT};font-size:15px;line-height:1.6;color:#1c1a59">${escapeHtml(line)}</td></tr>`,
		),
		input.url
			? `<tr><td style="padding:24px 32px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="#a47cc0" style="border-radius:10px;box-shadow:0 2px 0 #7b519b"><tr><td align="center" style="padding:12px 22px;${EMAIL_FONT};font-size:15px;font-weight:700"><a href="${escapeHtml(input.url)}" style="color:#1c1a59;text-decoration:none">Open the project</a></td></tr></table></td></tr>`
			: "",
		`<tr><td style="padding:32px 32px 4px;${EMAIL_FONT};font-size:14px;line-height:1.6;color:#4a4785">– Half Life</td></tr>`,
		"</table></td></tr></table>",
	]
		.filter(Boolean)
		.join("\n")
}

/**
 * Write one notice to every channel the maker is reachable by.
 *
 * The one place that knows a maker is reached by a Slack DM and an email, what each of them looks like, and that neither may fail the other. A notice that is owed is owed however the person prefers to be told, so both are attempted and each records its own failure rather than the second being skipped because the first threw.
 *
 * `note` is a reviewer's own words when there are any, sent as a boxed quote; a notice whose reason is ours (a failed send, say) leaves it null and says so in `prose` instead.
 */
async function deliverToMaker(input: {
	themeProjectId: string
	phase: Phase
	/** Recorded on the audit rows, so a channel failure names the notice it belonged to. */
	kind: string
	subject: string
	prose: readonly string[]
	note: string | null
	/** The accent for the note's box. Omitted by a notice that has no reviewer's words to draw one around. */
	ink?: string
	user: { name: string | null; email: string | null; slackId: string | null }
	/** Extra fields for the audit rows, for a notice whose kind and phase alone do not say enough. */
	meta?: Prisma.InputJsonObject
}): Promise<void> {
	const { email, slackId } = input.user
	const lines = plainLines(input)
	const url = projectUrl(input.themeProjectId)
	const firstName = input.user.name?.trim().split(/\s+/)[0] || "there"

	const ctx = {
		actorId: null,
		targetType: "ThemeProject",
		targetId: input.themeProjectId,
		metadata: { kind: input.kind, phase: input.phase, ...input.meta },
	}

	if (slackId) {
		const link = url ? `\n<${url}|Open the project>` : ""
		await trackSideEffect("slack", ctx, () => sendDM(slackId, `${lines.join("\n\n")}${link}`))
	}

	if (email) {
		const text = [
			`Hi ${firstName}`,
			"",
			...lines,
			...(url ? ["", `Open the project: ${url}`] : []),
			"",
			"– Half Life",
		].join("\n")

		const html = emailHtml({
			greeting: `Hi ${escapeHtml(firstName)}`,
			prose: input.prose,
			note: input.note,
			ink: input.ink,
			url,
		})

		await trackSideEffect("email", ctx, () => sendEmail({ to: email, subject: input.subject, text, html }))
	}
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

	const title = projectDisplayTitle(project)
	const message = reviewOutcomeMessage(notice, { phase: notice.phase, title })

	await deliverToMaker({
		themeProjectId: notice.themeProjectId,
		phase: notice.phase,
		kind: "review_outcome",
		subject: message.subject,
		prose: message.prose,
		note: message.note,
		ink: reviewInk(notice.result),
		user: project.user,
		meta: { result: notice.result, decidedBy: notice.decidedBy },
	})
}

/**
 * Tell the maker their hand-in never reached review.
 *
 * Owed once per stuck hand-in, and the caller decides that: this is the message, and `sendSubmissionToAri` only reaches for it on the transition into a stuck state. Best-effort like every other notice – the caller is the hourly retry job, and a mail outage must not turn one stuck hand-in into a failing job.
 */
export async function notifyShipFailed(input: { themeProjectId: string; phase: Phase; reason: string }): Promise<void> {
	try {
		const project = await prisma.themeProject.findUnique({
			where: { id: input.themeProjectId },
			select: {
				title: true,
				theme: true,
				user: { select: { name: true, email: true, slackId: true } },
			},
		})
		if (!project) return

		const title = projectDisplayTitle(project)
		const message = shipFailedMessage({ title, phase: input.phase, reason: input.reason })

		await deliverToMaker({
			themeProjectId: input.themeProjectId,
			phase: input.phase,
			kind: "ari_ship_failed",
			subject: message.subject,
			prose: message.prose,
			note: null,
			user: project.user,
		})
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		console.error(`[notifications] ship failure notice failed for ${input.themeProjectId}:`, err)
		await logAudit({
			action: AuditAction.NOTIFICATION_FAILURE,
			targetType: "ThemeProject",
			targetId: input.themeProjectId,
			metadata: {
				kind: "ari_ship_failed",
				phase: input.phase,
				stage: "before_channels",
				error: message,
			},
		}).catch(() => undefined)
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
