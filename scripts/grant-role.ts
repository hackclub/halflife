import "dotenv/config"
import { Role } from "../src/lib/enums"
import db from "../src/lib/prisma8"

/** `yarn grant-role you@example.com ADMIN` – the local bootstrap path. */
async function main() {
	const [email, roleArg] = process.argv.slice(2)
	if (!email || !roleArg) {
		console.error("usage: yarn grant-role <email> <ADMIN|REVIEWER|FULFILLER|AUDITOR>")
		process.exit(1)
	}
	const role = roleArg.toUpperCase() as Role
	if (!Object.values(Role).includes(role)) {
		console.error(`unknown role: ${roleArg}`)
		process.exit(1)
	}

	const user = await db.orm.public.User.where({ email }).select("id").first()
	if (!user) {
		console.error(`no user with email ${email}, sign in once first`)
		process.exit(1)
	}

	await db.orm.public.UserRole.createAll([{ grantedBy: "cli", role, userId: user.id }], { onConflict: "skip" })
	console.log(`granted ${role} to ${email}`)
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exit(1)
} finally {
	await db.close()
}
