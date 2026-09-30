import "server-only"
import prisma from "@/lib/prisma"

/**
 * How many people have an account, for the landing page's counter.
 *
 * The number the page shows is the `User` table's row count: every account the
 * platform knows about, whether it came in through Hack Club Auth or was
 * imported from an earlier programme.
 *
 * It is deliberately NOT the Airtable `Signups` list. That list holds people
 * who left an email on the landing page and may never have signed in, so
 * counting it would flash a number larger than the community the page is
 * claiming — the opposite of what social proof is for.
 *
 * `count` rather than loading rows: this runs on a public page load, and there
 * is no reason to pull five thousand user records across the wire to throw
 * four thousand nine hundred and ninety-nine of them away.
 */
export async function countAccounts(): Promise<number> {
  return prisma.user.count()
}
