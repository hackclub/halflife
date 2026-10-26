/** A value that can be read by key, once checked rather than asserted. */
export function isRecord(value: unknown): value is { [key: string]: unknown } {
	return typeof value === "object" && value !== null
}
