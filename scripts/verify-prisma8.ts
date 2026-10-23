import "dotenv/config"
import prisma from "@/lib/prisma"
import db from "@/lib/prisma8"
import {
	countContentReports,
	listAuditLog,
	listContentReports,
	listProjects,
	listRecentCommentsForModeration,
	listRecentPostsForModeration,
	listRecentPublicReels,
	listUsers,
} from "@/lib/queries/admin"
import { getJournalFeed } from "@/lib/queries/community"
import { listAllEvents, listUpcomingEvents } from "@/lib/queries/events"
import { getProfile } from "@/lib/queries/profile"
import { getMyReels } from "@/lib/queries/reels"
import { getReviewQueue } from "@/lib/queries/review"

const { users } = await db.orm.public.User.aggregate(a => ({ users: a.count() }))
console.log("user count:", users)

const recent = await db.orm.public.User.select("id", "name", "createdAt")
	.orderBy(u => u.createdAt.desc())
	.limit(2)
	.all()
console.log("recent users:", recent)
console.log("createdAt type:", typeof recent[0]?.createdAt)

const project = await db.orm.public.ThemeProject.select("id", "title")
	.include("user", u => u.select("id", "name"))
	.orderBy(p => p.createdAt.desc())
	.limit(1)
	.all()
console.log("project + user:", project)

// The exact queries behind the migrated /admin/shop page.
const items = await db.orm.public.ShopItem.orderBy([i => i.sortOrder.asc(), i => i.name.asc()]).all()
const regions = await db.orm.public.ShopRegion.select("id", "name", "active")
	.include("prices", prices => prices.count())
	.orderBy([r => r.sortOrder.asc(), r => r.name.asc()])
	.all()
console.log("shop items:", items.length)
console.log("shop regions:", regions)
console.log("region override count type:", typeof regions[0]?.prices)

// The audit page and its API route share this query; exercise the cursor too.
const audit = await listAuditLog({ limit: 2 })
const auditNext = audit.nextCursor ? await listAuditLog({ cursor: audit.nextCursor, limit: 2 }) : null
console.log("audit page:", audit.items.length, typeof audit.items[0]?.createdAt, "next:", Boolean(audit.nextCursor))
console.log("audit second page:", auditNext?.items.length ?? 0, auditNext?.items[0]?.id !== audit.items[0]?.id)

const events = await listAllEvents()
const upcoming = await listUpcomingEvents(new Date(Date.now() - 365 * 86_400_000), 3)
console.log(
	"events:",
	events.length,
	events[0]?.startsAt instanceof Date,
	"upcoming:",
	upcoming.length,
	upcoming[0]?.startsAt instanceof Date,
)

const poster = await db.orm.public.Post.select("userId")
	.where({ deletedAt: null })
	.orderBy(post => post.createdAt.desc())
	.first()
if (poster) {
	const reels = await getMyReels(poster.userId)
	console.log(
		"reel groups:",
		reels.length,
		"reels:",
		reels.reduce((n, group) => n + group.reels.length, 0),
		"at is number:",
		typeof reels[0]?.reels[0]?.at,
	)
	const queue = await getReviewQueue({ limit: 2, reviewerId: poster.userId })
	console.log("review queue:", queue.items.length, queue.counts, Boolean(queue.nextCursor))
	const profile = await getProfile(poster.userId, poster.userId)
	console.log("profile:", profile?.name, profile?.projects.length, profile?.reelCount, typeof profile?.joinedAt)
	const feed = await getJournalFeed()
	console.log("journal:", feed.length, typeof feed[0]?.when, feed[0]?.day)
}

const reports = await listContentReports("ALL", { limit: 2 })
const reportCounts = await countContentReports()
console.log("reports:", reports.items.length, typeof reports.items[0]?.createdAt, reportCounts)

const directory = await listUsers({ limit: 2 })
const projects = await listProjects({ limit: 2 })
const projectsQ = await listProjects({ limit: 2, q: "pcb" }, { includePii: true })
const projectsNext = projects.nextCursor ? await listProjects({ cursor: projects.nextCursor, limit: 2 }) : null
console.log(
	"projects:",
	projects.items.length,
	projects.items[0]?.updatedAt instanceof Date,
	"search:",
	projectsQ.items.length,
	"next:",
	projectsNext?.items.length ?? 0,
	projectsNext?.items[0]?.id !== projects.items[0]?.id,
)

const directoryQ = await listUsers({ limit: 2, q: directory.items[0]?.name?.slice(0, 3) ?? "a" }, { includePii: true })
console.log(
	"users:",
	directory.items.length,
	directory.items[0]?.createdAt instanceof Date,
	typeof directory.items[0]?.roles[0]?.role,
	"search:",
	directoryQ.items.length,
	Boolean(directory.nextCursor),
)

const moderatedPosts = await listRecentPostsForModeration(2)
const moderatedComments = await listRecentCommentsForModeration(2)
const publicReels = await listRecentPublicReels(2)
console.log(
	"moderation:",
	moderatedPosts.length,
	moderatedPosts[0]?.createdAt instanceof Date,
	moderatedComments.length,
	moderatedComments[0]?.createdAt instanceof Date,
	publicReels.length,
	publicReels[0]?.postedAt instanceof Date,
)

await db.close()
// Some migrated helpers still call the Prisma 7 client (for example the reel lock check), so close its pool too.
await prisma.$disconnect()
