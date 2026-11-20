/**
 * The public page for an HCB card grant. HCB stores the grant's id with a `cdg_` prefix, but its page is addressed by the id without that prefix.
 */
export function hcbGrantUrl(id: string): string {
	return `https://hcb.hackclub.com/grants/${id.replace(/^cdg_/, "")}`
}
