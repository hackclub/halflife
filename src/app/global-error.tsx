"use client"

export default function GlobalError({ reset }: Readonly<{ error: Error; reset: () => void }>) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <h1>Something broke</h1>
        <p>The error has been logged. Try again, and tell us in Slack if it keeps happening.</p>
        <button onClick={reset} style={{ padding: "0.5rem 1rem" }}>
          Try again
        </button>
      </body>
    </html>
  )
}
