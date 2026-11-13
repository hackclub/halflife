import { writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { listBom } from "../src/lib/bom"
import { bomTotalUsd } from "../src/lib/bom-policy"
import { starterProjectsFor } from "../src/lib/config/onboarding"
import { Theme } from "../src/lib/enums"
import db from "../src/lib/prisma8"

/**
 * Read-only: the site's BOM total and starter identity for each candidate maker in the Starbie top-up.
 *
 * Writes one row per project to `~/candidate-bom.tsv`. Nothing is written to the database.
 *
 *   bun --conditions=react-server scripts/starter-topup-bom-check.ts
 */

const EMAILS = [
	"10dania.ali@gmail.com",
	"absolutelyananya@gmail.com",
	"andytable0@gmail.com",
	"anvithpothula@gmail.com",
	"cristobal.nov3@gmail.com",
	"diegoemilianoreyesramos594@gmail.com",
	"greenblueknights@gmail.com",
	"imraghav012@gmail.com",
	"jaym54145@gmail.com",
	"kwokhez@outlook.com",
	"logan.reinecke@icloud.com",
	"maheshacked@gmail.com",
	"mithrasagar123@gmail.com",
	"naman.khabiya@gmail.com",
	"nbstrider@gmail.com",
	"obiedelstein@gmail.com",
	"prisonpro6758@gmail.com",
	"rishan.ramning@gmail.com",
	"rishi.govind.nair@gmail.com",
	"robertjkim12@gmail.com",
	"sadevlokunarangoda@gmail.com",
	"saul.c.cuevas@gmail.com",
	"sofia.e.kirilov@gmail.com",
	"srideetyathodupunoori@gmail.com",
	"toby834622@gmail.com",
	"williamta2024@yahoo.com",
	"ybyoo0715@gmail.com",
	"yihu999w@gmail.com",
	"yu.olivia.mi@gmail.com",
	"zoeygandhi@gmail.com",
]

const HEADER = [
	"email",
	"project_id",
	"starter_id",
	"design_status",
	"deleted",
	"tier",
	"title",
	"bom_usd",
	"grant_usd",
]

async function main(): Promise<void> {
	const wanted = new Set(EMAILS.map(email => email.toLowerCase()))
	const starterIds = new Set(starterProjectsFor(Theme.PCB).map(starter => starter.id))
	const users = await db.orm.public.User.where(user => user.email.in(EMAILS))
		.select("id", "email")
		.all()
	const emailByUser = new Map(users.map(user => [user.id, user.email.toLowerCase()]))
	const projects = await db.orm.public.ThemeProject.where(project => project.userId.in([...emailByUser.keys()]))
		.select(
			"id",
			"userId",
			"title",
			"tier",
			"designStatus",
			"deletedAt",
			"starterProjectId",
			"bomTaxShippingUsd",
			"grantUsd",
		)
		.all()

	const rows = [HEADER.join("\t")]
	for (const project of projects) {
		const email = emailByUser.get(project.userId) ?? ""
		if (!wanted.has(email)) continue
		const items = await listBom(project.id)
		const bom = bomTotalUsd(items, project.bomTaxShippingUsd)
		const isStarter = starterIds.has(project.starterProjectId ?? "")
		rows.push(
			[
				email,
				project.id,
				isStarter ? (project.starterProjectId ?? "-") : `${project.starterProjectId ?? "-"} (not Week 1)`,
				project.designStatus,
				project.deletedAt ? "yes" : "no",
				project.tier ?? "-",
				project.title,
				bom.toFixed(2),
				project.grantUsd ?? "-",
			].join("\t"),
		)
	}

	const path = join(homedir(), "candidate-bom.tsv")
	writeFileSync(path, `${rows.join("\n")}\n`, { mode: 0o600 })
	console.error(`${rows.length - 1} project(s) written to ${path}`)
}

try {
	await main()
} catch (err) {
	console.error(err instanceof Error ? err.message : err)
	process.exitCode = 1
} finally {
	await db.close()
}
