/**
 * Money rounding.
 *
 * Five modules each carried their own `round2` before this existed, and the reason it matters is not tidiness: these figures end up in a payout sheet. `bom-policy` works out what a tier funds, `airtable/sync` writes the requested funding to Airtable, and `ari` sends what Half Life believes is owed. If one of them rounds a half-cent differently from another, the two systems disagree about money with nothing in between to notice.
 */

/** Round to the cent. */
export const round2 = (n: number): number => Math.round(n * 100) / 100

/** Round to the cent, keeping null as "not set" – for a column that is genuinely absent rather than zero. */
export const dollars = (n: number | null) => (n === null ? null : round2(n))

const usdFormat = new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" })

export const formatUsd = (n: number) => usdFormat.format(n)
