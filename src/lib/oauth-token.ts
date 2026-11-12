import "server-only"

/**
 * One linked provider account's access token, decrypted and ready to send to the provider.
 *
 * better-auth stores OAuth tokens encrypted at rest (`account.encryptOAuthTokens` in lib/auth), so the value on the Account row is `$ba$…` ciphertext. Sending that as the bearer is a 401 that reads as "your sign-in is no longer valid", and reconnecting only writes another encrypted token – which is why pressing Reconnect appeared to do nothing. This asks better-auth for the token instead: it decrypts the stored value and, when the provider issues expiring tokens, refreshes it first.
 *
 * Concurrent callers for one account share a call. GitLab rotates its refresh token on every use, so two refreshes would make the second present a token the first just spent and fail a perfectly healthy link; joining them makes one refresh with one answer. The map is per process, so two instances can still race – the next call reads the row whichever of them won wrote.
 */
const inFlight = new Map<string, Promise<string | null>>()

type TokenSource = (accountId: string, userId: string) => Promise<string | null>

// Set by lib/auth once better-auth exists. This module cannot import lib/auth itself: auth depends on the modules that call this, so the import would close a cycle.
let tokenSource: TokenSource | null = null

export function registerOauthTokenSource(source: TokenSource): void {
	tokenSource = source
}

export function oauthAccessToken(accountId: string, userId: string): Promise<string | null> {
	const running = inFlight.get(accountId)
	if (running) return running
	const pending = (async () => {
		try {
			if (!tokenSource) throw new Error("No OAuth token source registered: lib/auth has not been loaded")
			return await tokenSource(accountId, userId)
		} finally {
			inFlight.delete(accountId)
		}
	})()
	inFlight.set(accountId, pending)
	return pending
}
