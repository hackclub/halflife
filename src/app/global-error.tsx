"use client"

/**
 * The last-resort error page. It replaces the whole document, so neither stylesheet loads and there is no design system to lean on – the button carries its own cursor, hover and press here.
 */
export default function GlobalError({ reset }: Readonly<{ error: Error; reset(): void }>) {
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
				<h1>Something broke</h1>
				<p>The error has been logged. Try again, and tell us in Slack if it keeps happening.</p>
				<button onClick={reset} type="button">
					Try again
				</button>
			</body>
		</html>
	)
}
