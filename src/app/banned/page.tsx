import { HardLink } from "@/components/site/HardLink"

/**
 * The screen a banned account reaches.
 *
 * The reason is deliberately not shown here, though it is free text in the admin record: sign-in is refused for banned accounts, so whoever lands on this page cannot be confirmed as the banned member. A reason typed for a moderator, reaching whoever typed the address, would put moderation notes in front of strangers. What a member gets instead is the one sentence they need and where to go.
 *
 * A member with a still-live session (suspension, for instance) never sees this: their penalty shows inside the app instead.
 */
export default function BannedPage() {
	return (
		<main className="mx-auto flex min-h-full max-w-md flex-1 flex-col justify-center px-6 text-center">
			<h1 className="font-hand text-3xl font-semibold">Account banned</h1>
			<p className="mt-3 text-hl-paper/80">
				This account can no longer access Half Life. If you believe this is a mistake, get in touch with the Half Life
				team.
			</p>
			<HardLink className="mt-6 underline underline-offset-4" href="/">
				Back to the landing page
			</HardLink>
		</main>
	)
}
