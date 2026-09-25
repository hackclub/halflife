import { headers } from "next/headers"
import Link from "next/link"
import { auth } from "@/lib/auth"
import { Panel } from "@/app/components/ui"
import { SignInButtons } from "@/app/components/forms/SignInButtons"

export const dynamic = "force-dynamic"

export default async function LoginPage() {
  const session = await auth.api.getSession({ headers: await headers() })

  return (
    <main className="hl-shell hl-stack">
      <h1 style={{ marginBottom: 0 }}>Sign in</h1>
      <Panel>
        <p className="hl-muted" style={{ marginTop: 0 }}>
          Half-Life uses your Hack Club account. Linking Hackatime is optional and only matters for firmware and code
          hours.
        </p>
        <SignInButtons hasSession={!!session} />
      </Panel>
      {session ? (
        <p>
          Signed in as {session.user.email}. <Link href="/dashboard">Go to your dashboard</Link>.
        </p>
      ) : null}
    </main>
  )
}
