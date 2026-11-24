/**
 * An item's grant card allowlist is the union of its linked merchants' IDs, in the order the merchants list them, with duplicates dropped. Empty means the card is unrestricted.
 */
export function unionMerchantIds(lists: readonly (readonly string[])[]): string[] {
	return [...new Set(lists.flat())]
}

/** Which links to add and which to remove to turn the current merchant links into the wanted ones. */
export function diffMerchantLinks(
	current: readonly string[],
	wanted: readonly string[],
): { add: string[]; remove: string[] } {
	const have = new Set(current)
	const want = new Set(wanted)
	return {
		add: [...want].filter(id => !have.has(id)),
		remove: [...have].filter(id => !want.has(id)),
	}
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

/** Whether a merchant's archive timestamp is set. Read by truthiness, because an unset column may come back as undefined as well as null. */
export const isArchived = (archivedAt: string | null | undefined): boolean => Boolean(archivedAt)
