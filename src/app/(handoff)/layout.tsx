import type { Metadata } from "next"
// The platform stylesheet, then the console's over it. The console's is the design system this page is drawn in; the platform's is where its one Tailwind entry comes from, so the phone page does not carry a second copy of Tailwind to stay in step.
import "../(platform)/globals.css"
import "../(platform)/ops.css"

export const metadata: Metadata = {
	// This page is reached from a QR code and is a one-shot upload target. Nothing about it should ever be indexed or shared onward.
	robots: { follow: false, index: false },
	title: "Record for Half-Life",
}

/**
 * A third root layout, for the phone.
 *
 * Separate from (platform) because this page is public by design – the whole point is recording without signing in on your phone – so it must not sit under a layout whose job is to enforce a session.
 */
export default function HandoffLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en">
			<body>
				<main className="ops-root hl-shell">{children}</main>
			</body>
		</html>
	)
}
