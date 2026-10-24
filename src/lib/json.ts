/**
 * A JSON value the app can store in a `Jsonb` column.
 *
 * Replaces `Prisma.InputJsonValue`: the same shape (objects allow `undefined` and readonly members, top-level `null` means SQL NULL), without the Prisma 7 client.
 */
export type InputJsonArray = readonly (InputJsonValue | null)[]

export type InputJsonObject = {
	readonly [_: string]: InputJsonValue | null | undefined
}

export type InputJsonValue = string | number | boolean | InputJsonObject | InputJsonArray | { toJSON(): unknown }

/**
 * A JSON value exactly as Prisma 8 stores it: no `undefined`, no readonly wrappers. Use this for anything written to a `Jsonb` column; `InputJsonValue` stays for looser boundaries that P7 code still feeds.
 */
export type JsonObject = { [_: string]: JsonValue }

export type JsonArray = JsonValue[]

export type JsonValue = string | number | boolean | null | JsonObject | JsonArray
