/**
 * The staff surfaces: the review queue, the admin console and the first-checkpoint flow.
 *
 * They carry their own stylesheet, which is now plain CSS rather than a second Tailwind entry: the platform's root layout above already imports Tailwind, and importing it again here shipped a duplicate preflight and utility layer. `ops.css` scopes its tokens to `.ops-root`, on the wrapper below, so after a client-side navigation out of the console the names it shares with the platform cannot repaint the trail.
 */
import "../ops.css"

export default function OpsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return <div className="ops-root">{children}</div>
}
