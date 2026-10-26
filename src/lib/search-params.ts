/**
 * The search parameters a page is handed, and the single value each of them carries.
 *
 * A parameter the URL names once arrives as a string; one it names twice arrives as an array. The pages that read them take each parameter as a single value, and an array where a string was expected is not a value any of them know how to read: `?q=a&q=b` reached Prisma as `contains: ["a","b"]` and threw, so a URL anyone can type was a 500.
 *
 * So the array is reduced before it reaches anything else, and the first value is the one that is kept: a repeated parameter is a URL the page's own form never sends, and the first value is the one it would have sent.
 */

/** A search parameter's value, as the framework hands it over. */
export type SearchParamValue = string | string[] | undefined

/** The shape a page's search parameters have once each one has been reduced to a single value. */
export type FirstValues<T extends { [K in keyof T]: SearchParamValue }> = { [K in keyof T]: string | undefined }

/**
 * One parameter's value, when the URL named it once.
 *
 * A parameter named several times keeps its first value; one named once is itself.
 */
export function firstValue(value: SearchParamValue): string | undefined {
	if (Array.isArray(value)) return value[0]
	return value
}

/**
 * Every parameter, each reduced to its first value.
 *
 * The keys the page asked for are the keys it gets back, and every value is a string or nothing – so the page reads the same names it always did, and reads them as strings.
 */
export function firstValues<T extends { [K in keyof T]: SearchParamValue }>(params: T): FirstValues<T> {
	const record = params as { [_: string]: SearchParamValue }
	const out: { [_: string]: string | undefined } = {}
	for (const key of Object.keys(record)) out[key] = firstValue(record[key])
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowing the compiler cannot verify without a runtime check
	return out as FirstValues<T>
}
