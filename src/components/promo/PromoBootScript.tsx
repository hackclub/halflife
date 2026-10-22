import { STICKER_SHEET_PROMO_KEY } from "./promo-state"

/**
 * Puts the remembered promo mode on `<html>` before the first paint.
 *
 * The server cannot read localStorage, so it always renders the banner. Without
 * this, someone who closed the promo would see it flash back on every load
 * before React remembered their choice. The stylesheet reads
 * `html[data-promo]` and hides the banner or the whole thing until the client
 * takes over, which is the same handful of pixels either way and no layout
 * shift for a visitor who never closed it.
 *
 * Inline rather than a module because it has to run before the stylesheet has
 * painted the banner, and it is only a read and a `dataset` write.
 */
const boot = `try{var m=localStorage.getItem(${JSON.stringify(STICKER_SHEET_PROMO_KEY)});if(m==="card"||m==="hidden")document.documentElement.dataset.promo=m}catch(e){}`

export function PromoBootScript() {
	return <script dangerouslySetInnerHTML={{ __html: boot }} />
}
