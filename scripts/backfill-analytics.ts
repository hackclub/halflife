import "dotenv/config"
import { backfillAnalytics } from "../src/lib/analytics"
import prisma from "../src/lib/prisma"

/**
 * Fill in the analytics markers (first project, first reel, active days, weekly hours and milestones) from what the database already holds, for everyone who was here before they were tracked. Safe to run again, and rebuilds every person's active days from their time entries outright.
 */
backfillAnalytics()
	.then((counts) => {
		console.log("analytics backfilled:", counts)
	})
	.catch((err) => {
		console.error(err)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
