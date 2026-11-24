/**
 * An item's grant card allowlist is the union of its linked merchants' IDs, in the order the merchants list them, with duplicates dropped. Empty means the card is unrestricted.
 */
export function unionMerchantIds(lists: readonly (readonly string[])[]): string[] {
	return [...new Set(lists.flat())]
}
