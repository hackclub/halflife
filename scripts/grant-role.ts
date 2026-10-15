import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../src/app/generated/prisma/client"
import { Role } from "../src/app/generated/prisma/enums"

const prisma = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
})

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

	const user = await prisma.user.findUnique({ where: { email } })
	if (!user) {
		console.error(`no user with email ${email}, sign in once first`)
		process.exit(1)
	}

	await prisma.userRole.upsert({
		create: { grantedBy: "cli", role, userId: user.id },
		update: {},
		where: { userId_role: { role, userId: user.id } },
	})
	console.log(`granted ${role} to ${email}`)
}

main()
	.catch(err => {
		console.error(err)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
