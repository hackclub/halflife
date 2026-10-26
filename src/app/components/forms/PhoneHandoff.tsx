"use client"
import { Button, Callout } from "@/app/components/ui"
import { useHandoff } from "@/lib/use-handoff"

/**
 * The desktop half of the handoff, in the staff console's dress.
 *
 * The rules – minting, polling, retiring the code once a phone has delivered – live in `useHandoff`, because the platform's reel modal needs exactly the same ones wearing completely different clothes. Only the markup is here.
 */
export function PhoneHandoff({ onReady }: Readonly<{ onReady(objectKey: string): void }>) {
	const { minted, status, error, mint } = useHandoff(onReady)
	const busy = status === "minting"

	return (
		<div className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}

			{!minted ? (
				<>
					<p className="hl-hint" style={{ margin: 0 }}>
						Record on your phone instead – scan a code, film it, and the video lands here. No signing in on the phone.
					</p>
					<div>
						<Button disabled={busy} onClick={mint}>
							{busy ? "Making a code…" : "Record on my phone"}
						</Button>
					</div>
				</>
			) : null}

			{minted && status === "waiting" ? (
				<div className="hl-stack hl-stack--tight">
					{/* Server-rendered SVG from our own origin – the token is never sent to a third-party QR service. */}
					<div
						aria-label="QR code linking to the upload page"
						dangerouslySetInnerHTML={{ __html: minted.qrSvg }}
						role="img"
						style={{ height: 200, width: 200 }}
					/>
					<p className="hl-hint" style={{ margin: 0 }}>
						Scan it with your phone camera. The code works once and expires shortly.
					</p>
					<details>
						<summary className="hl-hint">Can&rsquo;t scan it?</summary>
						<p className="hl-mono" style={{ wordBreak: "break-all" }}>
							{minted.url}
						</p>
					</details>
					<p className="hl-hint">Waiting for your phone…</p>
				</div>
			) : null}

			{status === "ready" ? <Callout>Got the video from your phone. Add a caption below and post it.</Callout> : null}

			{status === "expired" ? (
				<div className="hl-stack hl-stack--tight">
					<Callout tone="warning">That code expired before anything arrived.</Callout>
					<div>
						<Button disabled={busy} onClick={mint}>
							Make a new code
						</Button>
					</div>
				</div>
			) : null}
		</div>
	)
}
