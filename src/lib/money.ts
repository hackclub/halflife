/** Round to the cent, keeping null as "not set". */
export const dollars = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100)

const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

export const formatUsd = (n: number) => usdFormat.format(n)
