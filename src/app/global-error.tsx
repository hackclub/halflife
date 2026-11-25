"use client"

/** The codes a refused or unresolved database connection carries in its message, which a development build passes through to the page. */
const UNREACHABLE = /\b(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT)\b/

/**
 * The last-resort error page. It replaces the whole document, so neither stylesheet loads and there is no design system to lean on – the button carries its own cursor, hover and press here.
 *
 * A database that is down gets its own words, because "Something broke" tells the person nothing about what to start. Production redacts the message, so there it falls back to the general page and the server log carries the reason.
 */
export default function GlobalError({ error, reset }: Readonly<{ error: Error; reset(): void }>) {
	const unreachable = UNREACHABLE.test(error.message)
	const address = /ECONNREFUSED (\S+)/.exec(error.message)?.[1]
	return (
		<html lang="en">
			<head>
				<style
					dangerouslySetInnerHTML={{
						__html: `
							body { font-family: system-ui, sans-serif; padding: 2rem; }
							button { padding: 0.5rem 1rem; cursor: pointer; transition: background-color 120ms, transform 120ms; }
							button:hover { background: #e5e5e5; }
							button:active { transform: translateY(1px); }
						`,
					}}
				/>
			</head>
			<body>
				{unreachable ? (
					<>
						<h1>Half Life cannot reach its database</h1>
						<p>
							{address ? `Nothing answered at ${address}.` : "Nothing answered on the database's address."} Start the
							database and try again. In development that is the Postgres container from docker-compose.dev.yaml, and
							DATABASE_URL in .env must point at it.
						</p>
					</>
				) : (
					<>
						<h1>Something broke</h1>
						<p>The error has been logged. Try again, and tell us in Slack if it keeps happening.</p>
					</>
				)}
				<button onClick={reset} type="button">
					Try again
				</button>
			</body>
		</html>
	)
}
