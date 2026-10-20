import "server-only"
import type { Prisma } from "@/app/generated/prisma/client"
import { Phase, ReviewResult } from "@/app/generated/prisma/enums"
import { projectUrl, reviewUrl } from "@/lib/app-url"
import { ariReviewUrl } from "@/lib/ari-url"
import { AuditAction, logAudit } from "@/lib/audit"
import { projectDisplayTitle } from "@/lib/config/program"
import prisma from "@/lib/prisma"
import { formatProgramDate, getProgramSettings } from "@/lib/program"
import { trackSideEffect } from "@/lib/side-effects"
import { postMessage, sendDM } from "@/lib/slack"

/**
 * Telling a maker what a review decided.
 *
 * A Slack DM, and nothing else: email is sent from the submission's Airtable row by a Loops workflow, so nothing here mails anyone.
 *
 * Best-effort: a decision must never fail because Slack is down, so a failure becomes a `NOTIFICATION_FAILURE` audit row rather than an error. The in-app project page is still the source of truth, so a missed message is inconvenient, not lost.
 *
 * Called after the decision transaction has committed, from both decision paths (the console route and the Ari webhook), so the two cannot drift.
 */

export interface ReviewOutcomeNotice {
	/** Which surface decided it, so the message can say who is asking. */
	decidedBy: "ari" | "console"
	/**
	 * The reviewer's note to the maker, or null when there was none.
	 *
	 * Null is ordinary rather than exceptional: Ari decides without a note often enough that substituting its generic fallback would put "Reviewer's note: Ari asked for changes before this can be approved." into a maker's DM – a line that says the same thing twice and tells them nothing they can act on. The project page keeps whatever the review itself recorded; this is only what goes in the message.
	 */
	note: string | null
	phase: Phase
	result: ReviewResult
	themeProjectId: string
}

/**
 * Who to name, on the one outcome where the answer matters.
 *
 * A returned submission is a request to do something, so the maker needs to know who is asking. Ari is the bot. A console decision was made by a volunteer, and this deliberately does not name them: a reviewer's address has no business in a participant's DM, and the project page already shows the review it came from.
 */
function asker(decidedBy: "ari" | "console"): string {
	return decidedBy === "ari" ? "Ari" : "A Half Life reviewer"
}

/** The body of one outcome, in the voice the platform uses everywhere else. */
function headline(
	result: ReviewResult,
	phase: string,
	title: string,
	decidedBy: "ari" | "console",
	resubmitBy: string | null,
): { body: string; next?: string } {
	const what = `${phase} for ${title}`
	switch (result) {
		case ReviewResult.APPROVED:
			return { body: `Good news: your ${what} was approved.` }
		case ReviewResult.RETURNED:
			return {
				body: `${asker(decidedBy)} asked for changes on your ${what}.`,
				// The half that makes it actionable. What the status now permits is more work rather than less, and without this line the message reads as a verdict while the trail's own wording does the explaining somewhere a maker may never look. A return has just granted a week, so the date is worth more than "until it closes": it is the one thing the maker will come back to.
				next: resubmitBy
					? `Fix it and hand it in again from the project page – you have until ${resubmitBy} to resubmit.`
					: "Fix it and hand it in again from the project page – your week still takes submissions until it closes.",
			}
		case ReviewResult.REJECTED:
			return { body: `Your ${what} was not approved.` }
		default:
			return { body: `There is an update on your ${what}.` }
	}
}

export interface ReviewOutcomeMessage {
	/**
	 * The reviewer's own words, or null.
	 *
	 * Kept as its own field rather than a paragraph among the rest, because it is the one part a human typed and the only part with line breaks worth keeping: a channel that folds it into a sentence loses where one request ended and the next began.
	 */
	note: string | null
	/** Our words, in order. The reviewer's note is deliberately not among them. */
	prose: string[]
}

/**
 * The message a decision produces, as pure data.
 *
 * Separated from the sending so that what a maker is actually told can be read, and checked, without a Slack call: the words are the part that is easy to get wrong and the part nobody notices until a participant is confused by one.
 */
export function reviewOutcomeMessage(
	notice: Pick<ReviewOutcomeNotice, "result" | "decidedBy" | "note">,
	context: { phase: Phase; title: string; resubmitBy?: string | null },
): ReviewOutcomeMessage {
	const phaseLabel = context.phase === Phase.DESIGN ? "design" : "build"
	const { body, next } = headline(
		notice.result,
		phaseLabel,
		context.title,
		notice.decidedBy,
		context.resubmitBy ?? null,
	)
	const note = notice.note?.trim() || ""
	return { note: note || null, prose: [body, ...(next ? [next] : [])] }
}

/**
 * The message for a hand-in that never reached review.
 *
 * Deliberately not built from a review outcome: nothing has been reviewed, so there is no verdict to report and no reviewer to name. Calling this "changes requested" would describe a decision nobody made.
 *
 * The reason is the send's own refusal rather than a person's note, so it reads as one of our paragraphs instead of the set-apart quote a reviewer's words get. That also means it can change between attempts as the maker edits - only the project page follows it, because the notice itself is owed once.
 */
export function shipFailedMessage(source: { title: string; phase: Phase; reason: string }): {
	prose: string[]
} {
	const phase = source.phase === Phase.DESIGN ? "design" : "build"
	return {
		prose: [
			`Your ${phase} for ${source.title} was handed in, but it could not be sent for review, so nothing has been reviewed yet.`,
			source.reason,
			"Fix that on the project page, then hand it in again – if the week still shows as in review, take it back first.",
		],
	}
}

/**
 * The message as flat paragraphs, in the one order a plain-text channel wants.
 *
 * Ours first and the reviewer's last, so the note lands under the line that explains it. One definition instead of each caller reassembling the message, because the order is part of what the note means.
 */
function plainLines(message: { prose: readonly string[]; note: string | null }): string[] {
	return [...message.prose, ...(message.note ? [message.note] : [])]
}

/**
 * Write one notice to the maker as a Slack DM.
 *
 * The only channel: email goes out from the submission's Airtable row through a Loops workflow, so a decision is not mailed from here. A maker with no Slack id is told nothing by this deployment, which is the accepted trade – the project page still shows the decision.
 *
 * `note` is a reviewer's own words when there are any; a notice whose reason is ours (a failed send, say) passes none and says so in `prose` instead.
 */
async function deliverToMaker(input: {
	themeProjectId: string
	phase: Phase
	/** Recorded on the audit row, so a failure names the notice it belonged to. */
	kind: string
	prose: readonly string[]
	note: string | null
	slackId: string | null
	/** Extra fields for the audit row, for a notice whose kind and phase alone do not say enough. */
	meta?: Prisma.InputJsonObject
}): Promise<void> {
	const { slackId } = input
	if (!slackId) return

	const lines = plainLines(input)
	const url = projectUrl(input.themeProjectId)
	const link = url ? `\n<${url}|Open the project>` : ""

	await trackSideEffect(
		"slack",
		{
			actorId: null,
			metadata: { kind: input.kind, phase: input.phase, ...input.meta },
			targetId: input.themeProjectId,
			targetType: "ThemeProject",
		},
		() => sendDM(slackId, `${lines.join("\n\n")}${link}`),
	)
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
			metadata: {
				decidedBy: notice.decidedBy,
				error: message,
				kind: "review_outcome",
				phase: notice.phase,
				result: notice.result,
				// Which half of the send gave up. The channel records its own; this is everything before it, which is exactly the part nothing else watches.
				stage: "before_channels",
			},
			targetId: notice.themeProjectId,
			targetType: "ThemeProject",
		}).catch(() => undefined)
	}
}

async function deliverReviewOutcome(notice: ReviewOutcomeNotice): Promise<void> {
	const project = await prisma.themeProject.findUnique({
		select: {
			submissionExtensionUntil: true,
			theme: true,
			title: true,
			user: { select: { slackId: true } },
		},
		where: { id: notice.themeProjectId },
	})
	if (!project) return

	const title = projectDisplayTitle(project)
	// A return grants the project a week, so its message can name the day the maker can resubmit through. Formatted in the program's timezone, the same one the dashboard's own deadlines use, rather than the server's.
	const resubmitBy =
		notice.result === ReviewResult.RETURNED && project.submissionExtensionUntil
			? formatProgramDate(project.submissionExtensionUntil, (await getProgramSettings()).programTimezone)
			: null
	const message = reviewOutcomeMessage(notice, { phase: notice.phase, resubmitBy, title })

	await deliverToMaker({
		kind: "review_outcome",
		meta: { decidedBy: notice.decidedBy, result: notice.result },
		note: message.note,
		phase: notice.phase,
		prose: message.prose,
		slackId: project.user.slackId,
		themeProjectId: notice.themeProjectId,
	})
}

/**
 * Tell the maker their hand-in never reached review.
 *
 * Owed once per stuck hand-in, and the caller decides that: this is the message, and `sendSubmissionToAri` only reaches for it on the transition into a stuck state. Best-effort like every other notice – the caller is the hourly retry job, and a Slack outage must not turn one stuck hand-in into a failing job.
 */
export async function notifyShipFailed(input: { themeProjectId: string; phase: Phase; reason: string }): Promise<void> {
	try {
		const project = await prisma.themeProject.findUnique({
			select: {
				theme: true,
				title: true,
				user: { select: { slackId: true } },
			},
			where: { id: input.themeProjectId },
		})
		if (!project) return

		const title = projectDisplayTitle(project)
		const message = shipFailedMessage({ phase: input.phase, reason: input.reason, title })

		await deliverToMaker({
			kind: "ari_ship_failed",
			note: null,
			phase: input.phase,
			prose: message.prose,
			slackId: project.user.slackId,
			themeProjectId: input.themeProjectId,
		})
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		console.error(`[notifications] ship failure notice failed for ${input.themeProjectId}:`, err)
		await logAudit({
			action: AuditAction.NOTIFICATION_FAILURE,
			metadata: {
				error: message,
				kind: "ari_ship_failed",
				phase: input.phase,
				stage: "before_channels",
			},
			targetId: input.themeProjectId,
			targetType: "ThemeProject",
		}).catch(() => undefined)
	}
}

/** Escapes the three characters Slack mrkdwn gives meaning to, so interpolated text cannot become a mention or a link. */
function escapeSlackText(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

/**
 * Who decided the submission a dispute is about, and where its review and thread live.
 *
 * A console decision carries the reviewer's own account, so the id is one join away. An Ari decision has no account link by design (see `finalizeReview`), so the address Ari reported is matched to an account instead – the same resolution the daily review summary makes – and a reviewer with no account here pings nobody rather than the wrong person.
 *
 * The Ari link names the ship rather than the local row: Ari's path takes its own eight-character ship id, which is exactly what `ariSubmissionId` holds. The console link names the local submission because `/review/<id>` is where the dispute thread is read and answered; it is always available, unlike Ari's.
 */
async function disputeContext(
	submissionId: string,
): Promise<{ ariUrl: string | null; reviewPageUrl: string; slackId: string | null }> {
	const submission = await prisma.phaseSubmission.findUnique({
		select: {
			ariSubmissionId: true,
			reviews: {
				orderBy: { createdAt: "desc" },
				select: { reviewer: { select: { slackId: true } }, reviewerEmail: true },
				take: 1,
				where: { invalidated: false },
			},
		},
		where: { id: submissionId },
	})

	const review = submission?.reviews[0]
	let slackId = review?.reviewer?.slackId ?? null
	const email = review?.reviewerEmail?.trim()
	if (!slackId && email) {
		const account = await prisma.user.findFirst({
			select: { slackId: true },
			where: { email: { equals: email, mode: "insensitive" } },
		})
		slackId = account?.slackId ?? null
	}

	return {
		ariUrl: submission?.ariSubmissionId ? ariReviewUrl(submission.ariSubmissionId) : null,
		reviewPageUrl: reviewUrl(submissionId),
		slackId,
	}
}

/**
 * Ask staff to look again at a decision a maker has disputed.
 *
 * Posted to `SLACK_REVIEW_CHANNEL_ID` when it is set. A deployment without it still has the dispute in the console and the audit log, so nothing is lost.
 *
 * The reviewer who made the disputed decision is pinged and given links straight to the hand-in: the review console thread, where the dispute can be answered, and Ari, where the decision can be re-read and made again. Both are additions to the same channel post rather than a DM: the point is that whoever picks it up has the reviewer named and the conversation a click away. A reviewer with no account on this deployment, or a hand-in that never reached Ari, simply drops its half.
 */
export async function notifyStaffDispute(input: {
	/** The decided submission the dispute is against, so the reviewer and links can be found. */
	submissionId: string
	themeProjectId: string
	title: string
	phase: Phase
	note: string
	participant: string
}): Promise<void> {
	const channel = process.env.SLACK_REVIEW_CHANNEL_ID
	if (!channel) return
	const phase = input.phase === Phase.DESIGN ? "design" : "build"

	const { ariUrl, reviewPageUrl, slackId } = await disputeContext(input.submissionId)
	const disputeUrl = projectUrl(input.themeProjectId)
	// A participant's words land in staff's channel, where `<@U…>` and `<!channel>` are live mentions and `<url|text>` is a link; quoting does not neutralise them, so the three characters Slack mrkdwn gives meaning to are escaped. The reviewer ping and our own links are ours, so they stay outside the escaping.
	const quoted = escapeSlackText(input.note)
		.trim()
		.split("\n")
		.map(line => `> ${line}`)
		.join("\n")
	const links = [
		disputeUrl ? `<${disputeUrl}|Open the project>` : null,
		// Empty when the deployment names no origin (lib/app-url), so the link is left
		// out rather than sent with no URL in it.
		reviewPageUrl ? `<${reviewPageUrl}|Open the review thread>` : null,
		ariUrl ? `<${ariUrl}|Open the review on Ari>` : null,
	].filter(link => link !== null)
	const text = `${slackId ? `<@${slackId}> ` : ""}Review dispute on *${escapeSlackText(input.title)}* (${phase}) by ${escapeSlackText(input.participant)}:\n\n${quoted}${
		links.length > 0 ? `\n\n${links.join("\n")}` : ""
	}`
	await trackSideEffect(
		"slack",
		{ actorId: null, metadata: { kind: "review_dispute" }, targetId: input.themeProjectId, targetType: "ThemeProject" },
		() => postMessage(channel, text),
	)
}

/**
 * Tell the maker a reviewer has answered their dispute.
 *
 * Slack only, and best-effort: the thread on the project page is the record, the DM is the nudge, and there is no Airtable column for a dispute (Loops carries decisions, not conversations). Quiet in the same way as a review notice: a failure becomes a `NOTIFICATION_FAILURE` row rather than an error, because a reply that has already been written must not fail over a Slack outage.
 */
export async function notifyDisputeReply(input: { body: string; phase: Phase; themeProjectId: string }): Promise<void> {
	try {
		const project = await prisma.themeProject.findUnique({
			select: { theme: true, title: true, user: { select: { slackId: true } } },
			where: { id: input.themeProjectId },
		})
		if (!project) return

		const phase = input.phase === Phase.DESIGN ? "design" : "build"
		await deliverToMaker({
			kind: "dispute_reply",
			meta: { phase: input.phase },
			note: input.body,
			phase: input.phase,
			prose: [`A reviewer replied to your dispute on the ${phase} for ${projectDisplayTitle(project)}.`],
			slackId: project.user.slackId,
			themeProjectId: input.themeProjectId,
		})
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		console.error(`[notifications] dispute reply notice failed for ${input.themeProjectId}:`, err)
		await logAudit({
			action: AuditAction.NOTIFICATION_FAILURE,
			metadata: { error: message, kind: "dispute_reply", phase: input.phase, stage: "before_channels" },
			targetId: input.themeProjectId,
			targetType: "ThemeProject",
		}).catch(() => undefined)
	}
}
