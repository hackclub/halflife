import { symmetricEncrypt } from "better-auth/crypto"
import db from "../src/lib/prisma8"

/**
 * Re-encrypt forge OAuth tokens stored before `account.encryptOAuthTokens` was turned on.
 *
 * better-auth encrypts a token only when it writes one, and leaves a plaintext value alone when it reads it. GitHub
 * access tokens never refresh, so a row linked before the change keeps a plaintext `repo`-scoped token indefinitely –
 * write access to somebody's repositories, readable by anyone who sees the table.
 *
 * The encryption is better-auth's own (`$ba$` envelope, keyed from BETTER_AUTH_SECRET), so a backfilled row decodes
 * exactly like one written today. A value that already looks encrypted is skipped, and so is any provider whose tokens
 * this app never stores for a forge.
 *
 * Read-only unless `--commit` is passed. Run with
 * `bun --conditions=react-server scripts/backfill-encrypt-forge-tokens.ts [--commit]`, where `DATABASE_URL` and
 * `BETTER_AUTH_SECRET` point at the deployment being repaired.
 */

const FORGE_PROVIDERS = new Set(["github", "gitlab"])

/** The same test better-auth applies before it decrypts: an envelope, or a bare-hex payload. */
function likelyEncrypted(token: string): boolean {
	if (token.startsWith("$ba$")) return true
	return token.length % 2 === 0 && /^[0-9a-f]+$/i.test(token)
}

const commit = process.argv.includes("--commit")
const secret = process.env.BETTER_AUTH_SECRET?.trim()
if (!secret) throw new Error("BETTER_AUTH_SECRET is required: it is the key the tokens are encrypted with")

const accounts = await db.orm.public.Account.where(account => account.providerId.in([...FORGE_PROVIDERS]))
	.select("accessToken", "id", "providerId", "refreshToken")
	.all()

let encrypted = 0
let skipped = 0
let failed = 0
for (const account of accounts) {
	const rows: { accessToken?: string; id: string; providerId: string; refreshToken?: string } = {
		id: account.id,
		providerId: account.providerId,
	}
	let changed = false
	for (const field of ["accessToken", "refreshToken"] as const) {
		const value = account[field]
		if (!value) continue
		if (likelyEncrypted(value)) continue
		rows[field] = await symmetricEncrypt({ data: value, key: secret }).catch(err => {
			failed += 1
			console.error(`[forge-tokens] could not encrypt ${field} for account ${account.id}:`, err)
			return value
		})
		changed = true
	}
	if (!changed) {
		skipped += 1
		continue
	}
	if (commit) await db.orm.public.Account.where({ id: account.id }).update(rows)
	encrypted += 1
}

if (failed > 0 && commit)
	console.error(`[forge-tokens] ${failed} token(s) were left unchanged because encryption failed`)

console.log(
	JSON.stringify(
		{ accounts: accounts.length, commit, encrypted, failed, skipped, unchanged: accounts.length - encrypted - skipped },
		null,
		2,
	),
)

await db.close()
