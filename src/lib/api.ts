import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { API_ERROR_STATUS, type ApiErrorCode, HttpError } from "@/lib/errors"

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown }
}

/**
 * A successful response is the payload ITSELF. There is no `data` envelope.
 *
 * Worth stating because failures are not symmetrical — `fail()` wraps, in
 * `{ error: { code, message } }` — and the asymmetry invites a client to
 * assume both are wrapped. Three of them did, and the phone handoff and the
 * staff composer's upload spent their whole lives throwing "cannot read
 * properties of undefined (reading 'id')" as a result.
 *
 * If this ever grows an envelope, it has to grow one everywhere in the same
 * commit; half the callers reading `payload.data` is the state that hides.
 */
export function ok<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init)
}

/**
 * The only way to build an error response. The status comes from the code, so
 * the two can never disagree.
 */
export function fail(code: ApiErrorCode, message: string, details?: unknown): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status: API_ERROR_STATUS[code] },
  )
}

type Parsed<T> = { data: T; error?: never } | { data?: never; error: NextResponse<ApiErrorBody> }

/**
 * Parse and validate a JSON body. Handlers must never read a field off an
 * unvalidated object — that is how `undefined` reaches Prisma and becomes a
 * confusing runtime error three layers down.
 */
export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<Parsed<z.output<S>>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { error: fail("INVALID_BODY", "Request body must be valid JSON") }
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    return {
      error: fail("VALIDATION_FAILED", "Invalid request", z.treeifyError(result.error)),
    }
  }
  return { data: result.data }
}

export function parseQuery<S extends z.ZodType>(request: NextRequest, schema: S): Parsed<z.output<S>> {
  const raw = Object.fromEntries(request.nextUrl.searchParams.entries())
  const result = schema.safeParse(raw)
  if (!result.success) {
    return {
      error: fail("INVALID_QUERY", "Invalid query parameters", z.treeifyError(result.error)),
    }
  }
  return { data: result.data }
}

/**
 * Wraps a handler so a thrown HttpError becomes its proper response and
 * anything else becomes a logged 500 instead of an unhandled rejection.
 */
export function withRoute<A extends unknown[]>(
  handler: (...args: A) => Promise<NextResponse>,
): (...args: A) => Promise<NextResponse> {
  return async (...args: A) => {
    try {
      return await handler(...args)
    } catch (err) {
      if (err instanceof HttpError) return fail(err.code, err.message, err.details)
      console.error("[api] unhandled error:", err)
      return fail("INTERNAL", "Something went wrong")
    }
  }
}
