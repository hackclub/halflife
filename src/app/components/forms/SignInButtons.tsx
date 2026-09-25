"use client"
import { useState } from "react"
import { linkHackatime, signInWith } from "@/lib/auth-client"
import { Button, Callout } from "@/app/components/ui"

export function SignInButtons({ hasSession }: Readonly<{ hasSession: boolean }>) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="hl-stack hl-stack--tight">
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Button variant="primary" disabled={busy !== null} onClick={() => run("hca", () => signInWith("hca"))}>
        {busy === "hca" ? "Redirecting…" : "Continue with Hack Club"}
      </Button>
      {hasSession ? (
        <Button disabled={busy !== null} onClick={() => run("hackatime", () => linkHackatime())}>
          {busy === "hackatime" ? "Redirecting…" : "Link Hackatime"}
        </Button>
      ) : null}
    </div>
  )
}
