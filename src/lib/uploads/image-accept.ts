/**
 * The image formats a picker offers.
 *
 * The `accept` attribute on a file input is only a filter for the dialog – it is not a check, and a user can still reach any file by other means. The real gate is the magic-byte sniffing in `lib/uploads/r2.ts`, which is why these four rather than the fuller list that passes: an offer the server would then refuse is worse than a narrower offer.
 *
 * Kept as one string because that is the shape the attribute takes, and it had been written out four times with the risk of one drifting from another.
 */
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif"
