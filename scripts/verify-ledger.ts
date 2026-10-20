import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../src/app/generated/prisma/client"
import { Phase, PhaseStatus, ReviewResult, ShopItemCategory, Theme } from "../src/app/generated/prisma/enums"

/**
 * End-to-end check of the money path.
 *
 * The property that matters: approving a build, un-approving it, and approving it again must land on exactly the same balance as approving it once. That is what `reconcileGrant` buys, and it is the failure mode that costs real money
 * if it regresses.
 *
 * Run with `yarn tsx scripts/verify-ledger.ts` against a scratch database.
 */
const prisma = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
})

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
	const pass = JSON.stringify(actual) === JSON.stringify(expected)
	if (!pass) failures++
	console.log(
		`${pass ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
	)
}

async function main() {
	const { finalizeReview, unapprovePhase } = await import("../src/lib/review")
	const { getBalances } = await import("../src/lib/currency")
	const { getPrinterQualification } = await import("../src/lib/printer")
	const { buildCoinsFor } = await import("../src/lib/hours")
	const { THEME_COMPLETION_BONUS } = await import("../src/lib/config/program")

	const stamp = Date.now()
	const participant = await prisma.user.create({
		data: {
			email: `ledger-check-${stamp}@example.test`,
			name: "Ledger Check",
			verificationStatus: "verified",
		},
	})
	const reviewer = await prisma.user.create({
		data: { email: `reviewer-${stamp}@example.test`, name: "Reviewer" },
	})

	const project = await prisma.themeProject.create({
		data: {
			buildStatus: PhaseStatus.in_review,
			description: "A board for checking the ledger.",
			designStatus: PhaseStatus.approved,
			grantUsd: 30,
			theme: Theme.PCB,
			tier: 1,
			title: "Ledger check board",
			userId: participant.id,
		},
	})

	// 18 hours of journal work. A build has no funding floor, so all of it pays, spendable on anything.
	await prisma.workSession.create({
		data: {
			effectiveDate: "2026-10-01",
			hoursClaimed: 18,
			phase: Phase.BUILD,
			themeProjectId: project.id,
			title: "Assembly",
		},
	})

	// This exercise approves an 18h BUILD. Every hour earns, 5 coins each, spendable on anything.
	const buildSplit = buildCoinsFor(18)
	const expectedTotal = buildSplit.spendable + THEME_COMPLETION_BONUS

	async function approve() {
		const submission = await prisma.phaseSubmission.create({
			data: { phase: Phase.BUILD, themeProjectId: project.id },
		})
		await prisma.themeProject.update({
			data: { buildStatus: PhaseStatus.in_review },
			where: { id: project.id },
		})
		return finalizeReview({
			feedback: "Looks good.",
			reason: "18h of assembly work, evidenced.",
			result: ReviewResult.APPROVED,
			reviewerEmail: reviewer.email,
			reviewerId: reviewer.id,
			reviewerName: reviewer.name,
			submissionId: submission.id,
		})
	}

	const spendable = async () => (await prisma.$transaction(tx => getBalances(tx, participant.id))).spendable
	const banked = async () => (await prisma.$transaction(tx => getBalances(tx, participant.id))).banked

	check("starting balance", await spendable(), 0)

	const first = await approve()
	check("approved hours frozen", first.approvedHours, 18)
	check("build coins minted", first.coins?.spendable, buildSplit.spendable)
	check("a build banks nothing – every coin is spendable", first.coins?.banked, 0)
	check("balance after first approval", await spendable(), expectedTotal)
	check("no locked fund holds anything", await banked(), 0)

	await unapprovePhase(project.id, Phase.BUILD, reviewer.id, reviewer.email, "checking reversal")
	check("balance after un-approval returns to zero", await spendable(), 0)

	await approve()
	check("balance after re-approval does not double", await spendable(), expectedTotal)

	const entries = await prisma.ledgerEntry.count({ where: { userId: participant.id } })
	// A build approval writes two lines – the spendable mint and the completion bonus. The legacy locked half reconciles to a zero target against a zero sum, which writes nothing. This exercise approves, un-approves and re-approves. Six rows for three states: history is appended, never edited, and the running total still converges to the same place it started.
	const LINES_PER_BUILD_APPROVAL = 2
	check("ledger rows appended, never edited", entries, LINES_PER_BUILD_APPROVAL * 3)

	// Approving the remaining four themes should mint the printer award.
	const others = [Theme.CAD, Theme.SYNTH, Theme.DISPLAYS, Theme.BREADBOARD_COMPUTER]
	for (const theme of others)
		await prisma.themeProject.create({
			data: {
				buildStatus: PhaseStatus.approved,
				designStatus: PhaseStatus.approved,
				grantUsd: 30,
				theme,
				tier: 1,
				title: `${theme} check`,
				userId: participant.id,
			},
		})

	const qualification = await getPrinterQualification(participant.id)
	check("printer qualification", qualification.qualified, true)
	check("themes shipped", qualification.shippedCount, 5)

	// Nobody reviews their own work. Every account owns five themed projects, so without this a REVIEWER could approve their own design, set their own tier and mint their own credit.
	const selfSubmission = await prisma.phaseSubmission.create({
		data: { phase: Phase.DESIGN, themeProjectId: project.id },
	})
	let selfReviewRejected = false
	try {
		await finalizeReview({
			feedback: "Approving my own work.",
			result: ReviewResult.APPROVED,
			reviewerEmail: participant.email,
			reviewerId: participant.id,
			reviewerName: participant.name,
			submissionId: selfSubmission.id,
			tier: 3,
		})
	} catch {
		selfReviewRejected = true
	}
	check("self-review is refused", selfReviewRejected, true)

	// The balance must be untouched by the attempt.
	check("self-review minted nothing", await spendable(), expectedTotal)

	// Concurrent purchases must not double-spend. The balance is a SUM over an append-only table, so without a per-user lock ten parallel requests all read the same balance and all succeed.
	const { purchase } = await import("../src/lib/shop")
	await prisma.programSettings.update({
		data: { shopClosesAt: null, shopOpen: true },
		where: { id: "singleton" },
	})
	const item = await prisma.shopItem.create({
		data: {
			description: "Costs exactly the participant's whole balance.",
			id: `ledger-check-item-${stamp}`,
			maxPerUser: 0,
			name: "Ledger check widget",
			priceCredits: expectedTotal,
			requiresPrinterQualified: false,
		},
	})

	const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => purchase(participant.id, item.id, 1)))
	const succeeded = attempts.filter(a => a.status === "fulfilled").length
	check("only one of eight concurrent purchases succeeds", succeeded, 1)

	check("balance never goes negative", await spendable(), 0)

	// ── Single-pot minting ─────────────────────────────────────────────────────
	//
	// Everything above spends the one spendable pot. What follows is the invariant the merge rests on: there is no locked half anymore, so every minted coin lands spendable and the pacing math is guidance only.
	const { designCoinsFor } = await import("../src/lib/hours")
	const { PRINTERS, DESIGN_WEEKS, BUILD_WEEKS } = await import("../src/lib/config/printers")
	const { BUILD_HOURS } = await import("../src/lib/config/program")

	// Tier 1 funds 6h, so 11h earns on the 5 above it: 25 coins, all spendable.
	const design = designCoinsFor(1, 11)
	check("design mints nothing locked", design.banked, 0)
	check("design pays everything past funding as spendable", design.spendable, 25)

	// The tier only moves the funded block: Tier 3 funds 20h, so the equivalent week is 20 + 5.
	const tier3 = designCoinsFor(3, 25)
	check("tier does not change what earns", tier3.spendable, design.spendable)

	// The whole point of the catalogue: a season worked at a goal's own pace has to actually buy that goal. Five design weeks at its banking rate, plus five build weeks of BUILD_HOURS, must clear the price.
	//
	// This is the check that would have caught the economy this replaced, where the documented minimum path minted 175 coins and the cheapest machine that exists cost 219.
	for (const goal of PRINTERS) {
		const earned =
			DESIGN_WEEKS * designCoinsFor(1, 6 + goal.paceHours).total + BUILD_WEEKS * buildCoinsFor(BUILD_HOURS).total
		check(`a season at pace buys the ${goal.name}`, earned >= goal.coins, true)
	}

	const saver = await prisma.user.create({
		data: {
			email: `saver-${stamp}@example.test`,
			name: "Printer Fund Saver",
			verificationStatus: "verified",
		},
	})
	const saverSpendable = async () => (await prisma.$transaction(tx => getBalances(tx, saver.id))).spendable
	const saverBanked = async () => (await prisma.$transaction(tx => getBalances(tx, saver.id))).banked

	const designProject = await prisma.themeProject.create({
		data: {
			description: "A bracket for checking the printer fund.",
			designStatus: PhaseStatus.in_review,
			theme: Theme.CAD,
			title: "Ledger check bracket",
			userId: saver.id,
		},
	})
	await prisma.workSession.create({
		data: {
			effectiveDate: "2026-09-10",
			hoursClaimed: 11,
			phase: Phase.DESIGN,
			themeProjectId: designProject.id,
			title: "Modelling",
		},
	})
	const designSubmission = await prisma.phaseSubmission.create({
		data: { phase: Phase.DESIGN, themeProjectId: designProject.id },
	})
	const designOutcome = await finalizeReview({
		feedback: "Approved at Tier 1.",
		reason: "11h of modelling.",
		result: ReviewResult.APPROVED,
		reviewerEmail: reviewer.email,
		reviewerId: reviewer.id,
		reviewerName: reviewer.name,
		submissionId: designSubmission.id,
		tier: 1,
	})
	// Derived rather than typed out: these numbers move whenever the default goal is re-priced, and a hardcoded copy would only ever be discovered wrong by failing here long after the change that broke it.
	const expectedDesign = designCoinsFor(1, 11)
	check("design approval locks nothing", designOutcome.coins?.banked, 0)
	check("every earned coin lands spendable", await saverSpendable(), expectedDesign.spendable)
	check("the legacy locked pot stays empty", await saverBanked(), 0)

	// An upgrade costs part of the design mint. It must succeed: every coin is spendable on anything now, goal or no goal.
	const upgrade = await prisma.shopItem.create({
		data: {
			category: ShopItemCategory.PRINTER_UPGRADE,
			description: "Priced at part of the design mint.",
			id: `ledger-check-upgrade-${stamp}`,
			maxPerUser: 0,
			name: "Ledger check upgrade",
			priceCredits: 10,
			requiresPrinterQualified: false,
		},
	})
	await purchase(saver.id, upgrade.id, 1)
	check("spendable coins buy an upgrade", await saverSpendable(), expectedDesign.spendable - 10)
	check("the purchase moved nothing locked", await saverBanked(), 0)

	// A second upgrade-category item priced at everything left must succeed too,
	// and empty the pot. Printers themselves are no longer shop-buyable – the
	// shop hides the PRINTER category and purchase() refuses it, since machines
	// leave through the goal flow – so the pot-emptying purchase is exercised
	// with the same buyable category as the upgrade above.
	const printerItem = await prisma.shopItem.create({
		data: {
			category: ShopItemCategory.PRINTER_UPGRADE,
			description: "Priced at the rest of the design mint.",
			id: `ledger-check-printer-${stamp}`,
			maxPerUser: 0,
			name: "Ledger check printer",
			priceCredits: expectedDesign.spendable - 10,
			requiresPrinterQualified: false,
		},
	})
	await purchase(saver.id, printerItem.id, 1)
	check("a printer purchase empties the balance", await saverSpendable(), 0)
	check("and leaves nothing locked either", await saverBanked(), 0)

	// Clean up so the script is re-runnable. Order matters: SubmissionReview restricts deleting its reviewer, so the participant (whose projects cascade down to those reviews) has to go first.
	await prisma.user.delete({ where: { id: participant.id } })
	await prisma.user.delete({ where: { id: saver.id } })
	await prisma.user.delete({ where: { id: reviewer.id } })
	// The item can only go once the orders referencing it are gone with the user.
	await prisma.shopItem.delete({ where: { id: item.id } })
	await prisma.shopItem.delete({ where: { id: upgrade.id } })
	await prisma.shopItem.delete({ where: { id: printerItem.id } })
	await prisma.programSettings.update({
		data: { shopOpen: false },
		where: { id: "singleton" },
	})

	console.log(failures === 0 ? "\nAll ledger checks passed." : `\n${failures} check(s) failed.`)
	process.exit(failures === 0 ? 0 : 1)
}

main().catch(async err => {
	console.error(err)
	await prisma.$disconnect()
	process.exit(1)
})
