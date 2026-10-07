import "dotenv/config"
import { syncHcaProfile } from "../src/lib/hca-profile"
import prisma from "../src/lib/prisma"

/**
 * Fill in `User.displayName` – HCA's nickname, the name the site shows – for
 * everyone who signed in before the column existed, so the platform stops
 * showing full names only as people happen to come back.
 *
 * HCA is asked through each account's own refresh token, exactly as a sign-in
 * asks it, so this needs no privileged key and writes only what HCA answers.
 * An account whose token no longer refreshes is left falling back to the full
 * name and is picked up on their next sign-in, as is anyone with no HCA
 * account at all (a Stasis import has no token to ask with).
 *
 * Paced, because it is two HCA calls per person in the program. Safe to run
 * again: it starts from the rows still missing a display name.
 *
 * Run with `pnpm hca:backfill-display-names`.
 */
const PACE_MS = 250

async function main() {
	const users = await prisma.user.findMany({
		where: { displayName: null, accounts: { some: { providerId: "hca" } } },
		orderBy: { createdAt: "asc" },
		select: { id: true },
	})
	if (users.length === 0) {
		console.log("every account with an HCA identity already has a display name")
		return
	}

	const started = Date.now()
	let filled = 0
	let left = 0
	for (const user of users) {
		// Also refreshes the verification status and the address on file, which
		// is what a sign-in would have done anyway. Never throws.
		await syncHcaProfile(user.id)
		const row = await prisma.user.findUnique({ where: { id: user.id }, select: { displayName: true } })
		if (row?.displayName) {
			filled += 1
		} else {
			left += 1
			console.warn(`no answer from HCA for ${user.id}; they keep the full name until their next sign-in`)
		}
		await new Promise((resolve) => setTimeout(resolve, PACE_MS))
	}

	console.log(
		`display names: ${filled} filled, ${left} still falling back to the full name, ${users.length} asked in ${((Date.now() - started) / 1000).toFixed(1)}s`,
	)
}

main()
	.catch((err) => {
		console.error(err)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
