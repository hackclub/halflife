import "server-only"

/**
 * Transactional email.
 *
 * Resend's HTTP API directly rather than an SDK: it is one POST and keeps this deployment free of a mail library.
 *
 * Throws when unconfigured rather than no-oping quietly. The only caller is the review-outcome notifier, which turns a throw into a NOTIFICATION_FAILURE audit row – a deployment that forgot its mail credentials should show up in ops rather than assume people were told.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails"

export interface EmailInput {
	to: string
	subject: string
	text: string
	html?: string
}

export async function sendEmail(input: EmailInput): Promise<{ id: string }> {
	const key = process.env.RESEND_API_KEY
	const from = process.env.EMAIL_FROM
	if (!key || !from) throw new Error("Email is not configured: set RESEND_API_KEY and EMAIL_FROM")

	const res = await fetch(RESEND_ENDPOINT, {
		method: "POST",
		headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
		body: JSON.stringify({
			from,
			to: [input.to],
			subject: input.subject,
			text: input.text,
			...(input.html ? { html: input.html } : {}),
		}),
		signal: AbortSignal.timeout(10_000),
	})

	if (!res.ok) {
		// The body names the reason (unverified domain, bad key); keep it short so it is useful in the audit row without pasting a wall of HTML.
		const body = await res.text().catch(() => "")
		throw new Error(`Resend returned ${res.status}: ${body.slice(0, 200)}`)
	}
	const data = (await res.json()) as { id?: string }
	return { id: data.id ?? "" }
}
