/**
 * An item's grant card allowlist is the union of its linked merchants' IDs, in the order the merchants list them, with duplicates dropped. Empty means the card is unrestricted.
 */
export function unionMerchantIds(lists: readonly (readonly string[])[]): string[] {
	return [...new Set(lists.flat())]
}

/** The stable key a merchant is looked up by: its name, lowercased, with runs of anything else as a hyphen. */
export function merchantSlug(name: string): string {
	const slug = name
		.normalize("NFKD")
		.replaceAll(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-+|-+$/g, "")
	return slug || "merchant"
}
