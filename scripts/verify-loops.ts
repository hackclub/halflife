import { resolveSignupRow } from "../src/lib/airtable/loops"

/**
 * How the Loops sync finds the Signups row for a person.
 *
 * The join is the whole bug this exists for. It fails silently on purpose: a row
 * that is not found is skipped and counted, never an error, so matching on the
 * wrong key left every Loops column empty while the job reported success and
 * wrote nothing. The measured version of that: 5211 users, 5101 Signups rows,
 * one match.
 *
 * No network and no database, so this runs anywhere and needs no credentials.
 * Run with `pnpm verify:loops`.
 */

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
	const pass = JSON.stringify(actual) === JSON.stringify(expected)
	if (!pass) failures++
	console.log(
		`${pass ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
	)
}

const row = (id: string, fields: Record<string, unknown> = {}) => ({ id, fields })
const person = (id: string, email: string) => ({ id, email })

/** A table where the row's email is NOT the account's – the normal case. */
const divergent = {
	byEmail: new Map([["someone@gmail.com", row("recSignup")]]),
	byUserId: new Map([["cmuser123", row("recSignup")]]),
}

function main() {
	// The regression: this is the pair that used to match nothing at all, because
	// the account was issued a different address than the one on the sign-up row.
	check(
		"id finds the row when the emails disagree",
		resolveSignupRow(person("cmuser123", "kid@staging.hackclub.com"), divergent)?.by,
		"id",
	)

	// Same addresses: either key works, and the id is still preferred because it
	// is the one that cannot be ambiguous.
	const agreeing = {
		byEmail: new Map([["same@example.test", row("recA")]]),
		byUserId: new Map([["cmuser123", row("recA")]]),
	}
	check(
		"id is preferred when both agree",
		resolveSignupRow(person("cmuser123", "same@example.test"), agreeing)?.by,
		"id",
	)

	// A row the drain has not stamped yet still gets found by email.
	const unstamped = {
		byEmail: new Map([["fresh@example.test", row("recB")]]),
		byUserId: new Map<string, { id: string; fields: Record<string, unknown> }>(),
	}
	check(
		"email is the fallback for an unstamped row",
		resolveSignupRow(person("cmuser456", "fresh@example.test"), unstamped)?.by,
		"email",
	)

	// No row at all: skipped, not thrown. This is what keeps a half-migrated base
	// from turning into a failed job.
	check(
		"a person with no row is skipped, not an error",
		resolveSignupRow(person("cmnobody", "ghost@example.test"), unstamped),
		null,
	)

	// Case: the email fallback has to be case-insensitive, or every row whose
	// address was typed in a different case silently stops matching.
	const mixedCase = {
		byEmail: new Map([["typed@example.test", row("recC")]]),
		byUserId: new Map<string, { id: string; fields: Record<string, unknown> }>(),
	}
	check(
		"email match ignores case",
		resolveSignupRow(person("cmuser789", "  Typed@Example.Test "), mixedCase)?.by,
		"email",
	)

	// The failure that produced the bug report, asserted directly: email-only
	// indexing against a table of rows that share no address with the users.
	const emailOnly = {
		byEmail: new Map([["landed@example.test", row("recD")]]),
		byUserId: new Map<string, { id: string; fields: Record<string, unknown> }>(),
	}
	check(
		"a user whose sign-up address differs is still reachable by id",
		resolveSignupRow(person("cmuser000", "official@example.test"), {
			...emailOnly,
			byUserId: new Map([["cmuser000", row("recD")]]),
		})?.by,
		"id",
	)

	// The join that works on the live base. The `Half-Life User ID` column it was
	// designed around is not in the base, so the only key that needs no change to
	// Airtable is the record id the RSVP drain already wrote down – and that is
	// the case the Loops columns being empty actually came down to.
	const byRecordOnly = {
		byEmail: new Map<string, { id: string; fields: Record<string, unknown> }>(),
		byUserId: new Map<string, { id: string; fields: Record<string, unknown> }>(),
		byRecordId: new Map([["cmdrained", row("recDrained")]]),
	}
	check(
		"a drained record id matches with no user-id column and no email match",
		resolveSignupRow(person("cmdrained", "official@example.test"), byRecordOnly)?.by,
		"record",
	)
	check(
		"a drained record id wins over a wrong email match",
		resolveSignupRow(person("cmdrained", "typed@example.test"), {
			...byRecordOnly,
			byEmail: new Map([["typed@example.test", row("recWrong")]]),
		})?.row.id,
		"recDrained",
	)
	// Still ordered: a hand-set user id column outranks the drain's own record.
	check(
		"the user-id column still outranks the drained record id",
		resolveSignupRow(person("cmdrained", "official@example.test"), {
			...byRecordOnly,
			byUserId: new Map([["cmdrained", row("recById")]]),
		})?.by,
		"id",
	)
	// A person the app never drained, on a base with no id column, is still not
	// found. The record key is not a substitute for a join, it is a real mapping.
	check(
		"a person the app never drained is still skipped",
		resolveSignupRow(person("cmnever", "ghost@example.test"), byRecordOnly),
		null,
	)

	console.log(failures === 0 ? "\nAll Loops join checks passed." : `\n${failures} check(s) failed.`)
	process.exit(failures === 0 ? 0 : 1)
}

main()
