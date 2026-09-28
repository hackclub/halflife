/**
 * Boot-time configuration warnings.
 *
 * `PULL_HCA_PII` quietly disables itself when `PII_ENCRYPTION_KEY` is missing
 * (see lib/hca-profile), which is safe but leaves every grant row without an
 * address, so say so on every boot rather than finding out at payout time.
 *
 * The reverse — requesting PII scopes the HCA app does not hold — breaks every
 * sign-in, and can only be checked on the HCA app itself; docs/RUNBOOK has it
 * on the pre-launch list.
 */
export function register() {
  if (process.env.PULL_HCA_PII === "true" && !process.env.PII_ENCRYPTION_KEY) {
    console.error(
      "[config] PULL_HCA_PII=true but PII_ENCRYPTION_KEY is not set; address and birthday will not be stored",
    )
  }
}
