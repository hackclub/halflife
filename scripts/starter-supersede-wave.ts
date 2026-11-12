import { starterProjectsFor } from "../src/lib/config/onboarding"
import { Theme } from "../src/lib/enums"
import db from "../src/lib/prisma8"
import { supersedeLiveCards } from "../src/lib/starter-card-records"

/**
 * Supersede the wave export rows of Week 1 starters whose HCB cards were cancelled, so the starter funding export can pay them again.
 *
 * The first two waves wrote one live row per approved project, at the BOM amount. Starter cards that were cancelled on HCB still hold those rows, which would block the new card. Each `--keep` email is a starter whose card is still live on HCB, so its row stays live.
 *
 *   bun --conditions=react-server scripts/starter-supersede-wave.ts --keep a@example.com --keep b@example.com          (dry run)
 *   bun --conditions=react-server scripts/starter-supersede-wave.ts --keep a@example.com --keep b@example.com --apply
 *
 * Dry run is the default. Nothing is written unless `--apply` is passed.
 */

interface Args {
	apply: boolean
	keep: Set<string>
}

function parseArgs(argv: readonly string[]): Args {
	const args: Args = { apply: false, keep: new Set() }
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i]
		if (flag === "--apply") {
			args.apply = true
			continue
		}
		if (flag !== "--keep") throw new Error(`Unknown argument: ${flag}`)
		const value = argv[i + 1]
		if (!value) throw new Error("--keep needs an email")
		args.keep.add(value.trim().toLowerCase())
		i++
	}
	return args
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2))
	const starterIds = starterProjectsFor(Theme.PCB).map(starter => starter.id)
	const starterProjects = await db.orm.public.ThemeProject.where(project => project.starterProjectId.in(starterIds))
		.select("id")
		.all()
	const projectIds = starterProjects.map(project => project.id)

	const live = await db.orm.public.HcbCardGrantExportRow.where(row => row.supersededAt.isNull())
		.where(row => row.themeProjectId.in(projectIds))
		.select("amountCents", "email", "themeProjectId")
		.all()
	const toSupersede = live.filter(row => !args.keep.has(row.email.trim().toLowerCase()))
	const kept = live.length - toSupersede.length

	for (const row of toSupersede)
		console.error(`supersede\t${row.email}\t$${(row.amountCents / 100).toFixed(2)}\t${row.themeProjectId}`)
	const total = toSupersede.reduce((sum, row) => sum + row.amountCents, 0)
	console.error(
		`${live.length} live wave row(s) on Week 1 starters: ${toSupersede.length} to supersede ($${(total / 100).toFixed(2)}), ${kept} kept by --keep.`,
	)

	if (!args.apply) {
		console.error("Dry run. Pass --apply to supersede them.")
		return
	}
	const superseded = await supersedeLiveCards(
		toSupersede.map(row => row.themeProjectId),
		"cancelled on HCB; superseded so the starter card can be recorded",
	)
	console.error(`Superseded ${superseded} row(s).`)
}

try {
	await main()
} catch (err) {
	console.error(err instanceof Error ? err.message : err)
	process.exitCode = 1
} finally {
	await db.close()
}
