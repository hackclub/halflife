import { after } from "next/server"
import { SuspensionBanner } from "@/app/components/platform/SuspensionBanner"
import { AppShell } from "@/components/platform/shell/AppShell"
import { touchActivity } from "@/lib/analytics"
import { requireSessionPage } from "@/lib/page-guards"
import { getProgramSettings } from "@/lib/program"
import { listUpcomingEvents } from "@/lib/queries/events"
import { getStoreSnapshot } from "@/lib/queries/store"
import { StoreProvider } from "@/lib/store"

/**
 * Everything a participant sees: the trail, their projects, the shop, the Doomscroller and the reference pages, all inside the one shell.
 *
 * The group exists to draw the line at the shell rather than at the design system. `/login` wants the tokens and none of the chrome, and a reviewer working through a queue wants neither the trail's sidebar nor a store describing a programme they are not enrolled in.
 *
 * The session gate lives here, in a server component, and is the real one – the cookie check in `proxy.ts` only decides which page to render at `/`. Gating client-side would render the trail first and then take it away.
 *
 * It is also where the trail's data enters the app. Loading it in the layout rather than per page means one read serves every route under it, and a `router.refresh()` after a write reloads all of them at once.
 */
export const dynamic = "force-dynamic"
export default async function AppLayout({ children }: { children: React.ReactNode }) {
	const { penalty, user } = await requireSessionPage()
	// After the response: counting a page view must never slow one down.
	after(() => touchActivity(user.id))
	// The events come from here rather than from the dashboard page, because the countdown is in the shell's header and the header is in the layout: reading them per page would put a second calendar query on every route and leave the header empty on the ones that forgot.
	//
	// The lower bound is a cut-off, not a "has not started" filter. An event that began an hour ago and runs for two more is happening now, and dropping it would make the header count down to the next one while this one is still on.
	const [snapshot, events, settings] = await Promise.all([
		getStoreSnapshot(user.id),
		listUpcomingEvents(new Date(), 24),
		getProgramSettings(),
	])

	return (
		<StoreProvider snapshot={snapshot}>
			<AppShell events={events} programTimezone={settings.programTimezone} timezone={user.timezone}>
				{penalty === "suspended" ? (
					<div className="hl-stack" style={{ marginBottom: "1rem" }}>
						<SuspensionBanner userId={user.id} />
					</div>
				) : null}
				{children}
			</AppShell>
		</StoreProvider>
	)
}
