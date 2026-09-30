import type { Metadata } from "next"
// The same stylesheet as the platform, so the phone page does not need a
// second set of tokens to stay in step with.
import "../(platform)/ops.css"

export const metadata: Metadata = {
  title: "Record for Half-Life",
  // This page is reached from a QR code and is a one-shot upload target.
  // Nothing about it should ever be indexed or shared onward.
  robots: { index: false, follow: false },
}

/**
 * A third root layout, for the phone.
 *
 * Separate from (platform) because this page is public by design — the whole
 * point is recording without signing in on your phone — so it must not sit
 * under a layout whose job is to enforce a session.
 */
export default function HandoffLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <main className="hl-shell">{children}</main>
      </body>
    </html>
  )
}
