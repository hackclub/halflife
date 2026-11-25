import { ADMIN_THEME_KEY } from "@/lib/admin-theme"

/**
 * Puts the remembered admin mode on `<html>` before the first paint.
 *
 * The server cannot read localStorage, so it always draws the console light. Without this, a reload of a remembered dark console flashes cream before React hydrates and applies the mode, which reads as the choice not sticking. The stylesheet switches on `html[data-theme="dark"]`, so setting the attribute here makes the first paint match what was stored. The platform layout already marks `<html>` with `suppressHydrationWarning` for the same reason; this attribute is the same kind of intentional difference.
 */
const boot = `try{var t=localStorage.getItem(${JSON.stringify(ADMIN_THEME_KEY)});if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`

export function ThemeBootScript() {
	return <script dangerouslySetInnerHTML={{ __html: boot }} />
}
