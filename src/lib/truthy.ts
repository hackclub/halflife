/**
 * `if (value)` as a function, for conditions on values that are not plainly boolean. It answers exactly what the bare condition would, and narrows the same way: a `string | null` that is truthy is a non-empty string.
 */
export function isTruthy<T>(value: T): value is Exclude<T, null | undefined | false | "" | 0> {
	return Boolean(value)
}
