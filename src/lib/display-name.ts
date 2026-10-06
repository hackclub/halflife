/**
 * The name a person is shown as, and the one place that rule is written.
 *
 * HCA answers with two names. `name` is "first last" — the same string it
 * copies into its own legal-name columns when those are empty — and it is what
 * everything needing a whole person keeps: the Airtable RSVP and YSWS rows,
 * Ari, the participant export. `nickname` is what they go by; it is read from
 * the one place HCA is asked (lib/hca-profile) and stored as
 * `User.displayName` at every sign-in, and it is what this site shows.
 *
 * A null `displayName` means "no nickname on file yet" — a row from before the
 * column existed, or a sign-in that has not synced since — never "this person
 * has no name", so the caller's fallback is what keeps a row from rendering
 * blank.
 *
 * Deliberately pure (no server-only) so both the server queries and a renderer
 * can name it. Same rule as lib/avatar.ts.
 */

interface Person {
	name?: string | null
	displayName?: string | null
}

export function displayName(person: Person | null | undefined, fallback: string): string
export function displayName(person: Person | null | undefined, fallback?: null): string | null
export function displayName(person: Person | null | undefined, fallback: string | null = null): string | null {
	const nickname = person?.displayName?.trim()
	if (nickname) return nickname
	return person?.name?.trim() || fallback
}
