import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../src/app/generated/prisma/client"
import {
  Phase,
  PhaseStatus,
  ReviewResult,
  ShopItemCategory,
  Theme,
} from "../src/app/generated/prisma/enums"

/**
 * End-to-end check of the money path.
 *
 * The property that matters: approving a build, un-approving it, and approving
 * it again must land on exactly the same balance as approving it once. That is
 * what `reconcileGrant` buys, and it is the failure mode that costs real money
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
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
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
      userId: participant.id,
      theme: Theme.PCB,
      title: "Ledger check board",
      description: "A board for checking the ledger.",
      designStatus: PhaseStatus.approved,
      tier: 1,
      grantUsd: 30,
      buildStatus: PhaseStatus.in_review,
    },
  })

  // 18 hours of journal work. A build has no funding floor, so all of it pays.
  await prisma.workSession.create({
    data: {
      themeProjectId: project.id,
      phase: Phase.BUILD,
      title: "Assembly",
      hoursClaimed: 18,
      effectiveDate: "2026-10-01",
    },
  })

  // This exercise approves an 18h BUILD. The first BUILD_HOURS of it bank —
  // that is the flat contribution every machine's price is paced against — and
  // the rest is spendable.
  const buildSplit = buildCoinsFor(18)
  const expectedTotal = buildSplit.spendable + THEME_COMPLETION_BONUS

  async function approve() {
    const submission = await prisma.phaseSubmission.create({
      data: { themeProjectId: project.id, phase: Phase.BUILD },
    })
    await prisma.themeProject.update({
      where: { id: project.id },
      data: { buildStatus: PhaseStatus.in_review },
    })
    return finalizeReview({
      submissionId: submission.id,
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
      reviewerEmail: reviewer.email,
      result: ReviewResult.APPROVED,
      feedback: "Looks good.",
      reason: "18h of assembly work, evidenced.",
    })
  }

  const spendable = async () =>
    (await prisma.$transaction((tx) => getBalances(tx, participant.id))).spendable
  const banked = async () =>
    (await prisma.$transaction((tx) => getBalances(tx, participant.id))).banked

  check("starting balance", await spendable(), 0)

  const first = await approve()
  check("approved hours frozen", first.approvedHours, 18)
  check("build coins minted", first.coins?.spendable, buildSplit.spendable)
  check("a build banks its first BUILD_HOURS", first.coins?.banked, buildSplit.banked)
  check("balance after first approval", await spendable(), expectedTotal)
  check("the printer fund holds them", await banked(), buildSplit.banked)

  await unapprovePhase(project.id, Phase.BUILD, reviewer.id, reviewer.email, "checking reversal")
  check("balance after un-approval returns to zero", await spendable(), 0)

  await approve()
  check("balance after re-approval does not double", await spendable(), expectedTotal)

  const entries = await prisma.ledgerEntry.count({ where: { userId: participant.id } })
  // A build approval writes three lines — the banked half, the spendable half
  // and the completion bonus — and this exercise approves, un-approves and
  // re-approves. Nine rows for three states: history is appended, never edited,
  // and the running total still converges to the same place it started.
  const LINES_PER_BUILD_APPROVAL = 3
  check("ledger rows appended, never edited", entries, LINES_PER_BUILD_APPROVAL * 3)

  // Approving the remaining four themes should mint the printer award.
  const others = [Theme.CAD, Theme.SYNTH, Theme.DISPLAYS, Theme.BREADBOARD_COMPUTER]
  for (const theme of others) {
    await prisma.themeProject.create({
      data: {
        userId: participant.id,
        theme,
        title: `${theme} check`,
        designStatus: PhaseStatus.approved,
        buildStatus: PhaseStatus.approved,
        tier: 1,
        grantUsd: 30,
      },
    })
  }
  const qualification = await getPrinterQualification(participant.id)
  check("printer qualification", qualification.qualified, true)
  check("themes shipped", qualification.shippedCount, 5)

  // Nobody reviews their own work. Every account owns five themed projects, so
  // without this a REVIEWER could approve their own design, set their own tier
  // and mint their own credit.
  const selfSubmission = await prisma.phaseSubmission.create({
    data: { themeProjectId: project.id, phase: Phase.DESIGN },
  })
  let selfReviewRejected = false
  try {
    await finalizeReview({
      submissionId: selfSubmission.id,
      reviewerId: participant.id,
      reviewerName: participant.name,
      reviewerEmail: participant.email,
      result: ReviewResult.APPROVED,
      feedback: "Approving my own work.",
      tier: 3,
    })
  } catch {
    selfReviewRejected = true
  }
  check("self-review is refused", selfReviewRejected, true)

  // The balance must be untouched by the attempt.
  check("self-review minted nothing", await spendable(), expectedTotal)

  // Concurrent purchases must not double-spend. The balance is a SUM over an
  // append-only table, so without a per-user lock ten parallel requests all
  // read the same balance and all succeed.
  const { purchase } = await import("../src/lib/shop")
  await prisma.programSettings.update({
    where: { id: "singleton" },
    data: { shopOpen: true, shopClosesAt: null },
  })
  const item = await prisma.shopItem.create({
    data: {
      id: `ledger-check-item-${stamp}`,
      name: "Ledger check widget",
      description: "Costs exactly the participant's whole balance.",
      priceCredits: expectedTotal,
      maxPerUser: 0,
      requiresPrinterQualified: false,
    },
  })

  const attempts = await Promise.allSettled(
    Array.from({ length: 8 }, () => purchase(participant.id, item.id, 1)),
  )
  const succeeded = attempts.filter((a) => a.status === "fulfilled").length
  check("only one of eight concurrent purchases succeeds", succeeded, 1)

  check("balance never goes negative", await spendable(), 0)

  // ── The printer fund ───────────────────────────────────────────────────────
  //
  // Everything above spends the ordinary pot. What follows is the invariant the
  // forced-savings rule rests on: banked coins are legal tender for a printer
  // and for nothing else. If this ever passes by accident, the rule is decor.
  const { designCoinsFor } = await import("../src/lib/hours")
  const { PRINTERS, printerById, DEFAULT_GOAL_ID, DESIGN_WEEKS, BUILD_WEEKS } =
    await import("../src/lib/config/printers")
  const { BUILD_HOURS } = await import("../src/lib/config/program")

  // Tier 1 funds 6h. Saving for an Ender the goal asks 3.76h of banking on top,
  // so 11h is 3.76h banked (19 coins, rounded up) and 1.24h spendable (6).
  const ender = printerById("ender-3-v3-se")
  const design = designCoinsFor(1, ender, 11)
  check("design banks the goal's weekly rate", design.banked, 19)
  check("design pays the rest as spendable", design.spendable, 6)

  // Banking is paced by the machine, not the tier: the same goal banks the same
  // amount whatever tier is underneath it. Tier 3 funds 20h, so the equivalent
  // week is 20 + 3.76 + 1.24.
  const tier3 = designCoinsFor(3, ender, 25)
  check("tier does not change what banks", tier3.banked, design.banked)
  check("tier only moves the funded block", tier3.spendable, design.spendable)

  // The whole point of the catalogue: a season worked at a goal's own pace has
  // to actually buy that goal. Five design weeks at its banking rate, plus five
  // build weeks of BUILD_HOURS, must clear the price.
  //
  // This is the check that would have caught the economy this replaced, where
  // the documented minimum path minted 175 coins and the cheapest machine that
  // exists cost 219.
  for (const goal of PRINTERS) {
    const banked =
      DESIGN_WEEKS * designCoinsFor(1, goal, 6 + goal.bankedHours).banked +
      BUILD_WEEKS * buildCoinsFor(BUILD_HOURS).banked
    check(`a season at pace buys the ${goal.name}`, banked >= goal.coins, true)
  }

  const saver = await prisma.user.create({
    data: {
      email: `saver-${stamp}@example.test`,
      name: "Printer Fund Saver",
      verificationStatus: "verified",
    },
  })
  const saverSpendable = async () =>
    (await prisma.$transaction((tx) => getBalances(tx, saver.id))).spendable
  const saverBanked = async () =>
    (await prisma.$transaction((tx) => getBalances(tx, saver.id))).banked

  const designProject = await prisma.themeProject.create({
    data: {
      userId: saver.id,
      theme: Theme.CAD,
      title: "Ledger check bracket",
      description: "A bracket for checking the printer fund.",
      designStatus: PhaseStatus.in_review,
    },
  })
  await prisma.workSession.create({
    data: {
      themeProjectId: designProject.id,
      phase: Phase.DESIGN,
      title: "Modelling",
      hoursClaimed: 11,
      effectiveDate: "2026-09-10",
    },
  })
  const designSubmission = await prisma.phaseSubmission.create({
    data: { themeProjectId: designProject.id, phase: Phase.DESIGN },
  })
  const designOutcome = await finalizeReview({
    submissionId: designSubmission.id,
    reviewerId: reviewer.id,
    reviewerName: reviewer.name,
    reviewerEmail: reviewer.email,
    result: ReviewResult.APPROVED,
    feedback: "Approved at Tier 1.",
    reason: "11h of modelling.",
    tier: 1,
  })
  // Derived rather than typed out: these numbers move whenever the default goal
  // is re-priced, and a hardcoded copy would only ever be discovered wrong by
  // failing here long after the change that broke it.
  const saverGoal = printerById(DEFAULT_GOAL_ID)
  const expectedDesign = designCoinsFor(1, saverGoal, 11)
  check("design approval banks the goal's rate", designOutcome.coins?.banked, expectedDesign.banked)
  check("printer fund holds the banked coins", await saverBanked(), expectedDesign.banked)
  check("spendable got the overtime only", await saverSpendable(), expectedDesign.spendable)

  // An upgrade costs more than the spendable pot but less than the two
  // combined. It must be refused: the printer fund is not available to it.
  const upgrade = await prisma.shopItem.create({
    data: {
      id: `ledger-check-upgrade-${stamp}`,
      name: "Ledger check upgrade",
      description: "Priced between the spendable pot and the combined total.",
      category: ShopItemCategory.PRINTER_UPGRADE,
      // More than the spendable pot, less than the two combined. Derived so it
      // stays on that knife edge when the default goal is re-priced.
      priceCredits: expectedDesign.spendable + 1,
      maxPerUser: 0,
      requiresPrinterQualified: false,
    },
  })
  let upgradeRefused = false
  try {
    await purchase(saver.id, upgrade.id, 1)
  } catch {
    upgradeRefused = true
  }
  check("banked coins cannot buy an upgrade", upgradeRefused, true)
  check("the refused purchase moved nothing", await saverBanked(), expectedDesign.banked)

  // A printer priced at everything they have must succeed, and must drain the
  // banked pot FIRST — the spendable one is meant to survive as long as it can.
  const printerItem = await prisma.shopItem.create({
    data: {
      id: `ledger-check-printer-${stamp}`,
      name: "Ledger check printer",
      description: "The cheapest printer in the world.",
      category: ShopItemCategory.PRINTER,
      priceCredits: expectedDesign.total,
      maxPerUser: 0,
      requiresPrinterQualified: false,
    },
  })
  await purchase(saver.id, printerItem.id, 1)
  check("a printer drains the fund first", await saverBanked(), 0)
  check("and takes the remainder from spendable", await saverSpendable(), 0)

  // Clean up so the script is re-runnable. Order matters: SubmissionReview
  // restricts deleting its reviewer, so the participant (whose projects cascade
  // down to those reviews) has to go first.
  await prisma.user.delete({ where: { id: participant.id } })
  await prisma.user.delete({ where: { id: saver.id } })
  await prisma.user.delete({ where: { id: reviewer.id } })
  // The item can only go once the orders referencing it are gone with the user.
  await prisma.shopItem.delete({ where: { id: item.id } })
  await prisma.shopItem.delete({ where: { id: upgrade.id } })
  await prisma.shopItem.delete({ where: { id: printerItem.id } })
  await prisma.programSettings.update({
    where: { id: "singleton" },
    data: { shopOpen: false },
  })

  console.log(failures === 0 ? "\nAll ledger checks passed." : `\n${failures} check(s) failed.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
