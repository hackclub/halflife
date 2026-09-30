/**
 * The staff and signed-out surfaces: the review queue, the admin console, the
 * login page and the first-checkpoint flow.
 *
 * They carry their own stylesheet. These pages were written against the
 * platform's earlier design system, and `ops.css` is that system, kept whole
 * rather than half-translated. It loads after `globals.css` and redefines four
 * tokens it shares with it (`--color-ink`, `--color-magenta`, `--color-mint`,
 * `--color-teal`), which is why it is scoped to this group instead of the root:
 * loaded globally it would quietly repaint the trail.
 */
import "../ops.css"

export default function OpsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children
}
