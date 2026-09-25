/**
 * Closed set of API error codes, each bound to the status it always returns.
 * Pairing them here means a handler cannot accidentally send CONFLICT with a
 * 400, and clients can branch on the code rather than parsing prose.
 */
export const API_ERROR_STATUS = {
  // 400 — the caller sent something malformed
  INVALID_BODY: 400,
  VALIDATION_FAILED: 400,
  INVALID_QUERY: 400,

  // 401 / 403 — who you are
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_VERIFIED: 403,

  // 404 — not found, or found but not visible to this caller. Participants
  // asking about someone else's project get this, never 403: don't leak the
  // ID space.
  NOT_FOUND: 404,

  // 409 — well-formed and permitted, but the world is in the wrong state.
  // This is the code the UI branches on most.
  CONFLICT: 409,
  ALREADY_SUBMITTED: 409,
  NOT_SUBMITTED: 409,
  PHASE_LOCKED: 409,
  CLAIMED_BY_OTHER: 409,
  ALREADY_RESOLVED: 409,
  SUBMISSIONS_CLOSED: 409,
  WEEK_CLOSED: 409,
  /** A deleted reel has to be re-recorded before anything else moves. */
  REEL_OWED: 409,
  SHOP_CLOSED: 409,
  INSUFFICIENT_CREDIT: 409,
  OUT_OF_STOCK: 409,
  PURCHASE_LIMIT: 409,
  ITEM_LOCKED: 409,
  DESIGN_NOT_APPROVED: 409,
  LAST_ADMIN: 409,

  // 422 — well-formed and permitted but semantically impossible
  UNPROCESSABLE: 422,
  HACKATIME_NOT_LINKED: 422,
  HACKATIME_STALE: 422,
  LAPSE_NOT_LINKED: 422,
  LAPSE_UNAVAILABLE: 503,

  // 429 / 500 / 503
  RATE_LIMITED: 429,
  INTERNAL: 500,
  NOT_CONFIGURED: 503,
  /** A service this depends on (the signup list, say) did not answer. */
  UNAVAILABLE: 503,
} as const

export type ApiErrorCode = keyof typeof API_ERROR_STATUS

export class HttpError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = "HttpError"
  }

  get status(): number {
    return API_ERROR_STATUS[this.code]
  }
}
