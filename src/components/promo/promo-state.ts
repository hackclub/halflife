/**
 * Where the sticker-sheet promotion is, across page loads.
 *
 * The promo has three positions and they are all remembered: open at the top,
 * collapsed to its floating card, or gone. The card is a way back rather than a
 * lesser banner, so only its own close button writes `hidden`.
 *
 * The state travels through a subscription rather than context because the two
 * root layouts that mount the banner do not share one, and the platform's shell
 * already carries enough providers. Reading it from `window` also means the
 * landing can stay static: nothing here is server-rendered per visitor.
 */

type PromoMode = "banner" | "card" | "hidden"

const STICKER_SHEET_PROMO_KEY = "half-life:promo:sticker-sheet"

const listeners = new Set<() => void>()

/** The last value written in this tab, so the promo still closes where storage is blocked. */
let memory: PromoMode | null = null

function isMode(value: string | null): value is PromoMode {
	return value === "banner" || value === "card" || value === "hidden"
}

function emit(): void {
	for (const listener of listeners) listener()
}

/**
 * The mode as it is now. A string, so React can compare it by value.
 */
export function getPromoMode(): PromoMode {
	if (memory) return memory
	try {
		const stored = window.localStorage.getItem(STICKER_SHEET_PROMO_KEY)
		return isMode(stored) ? stored : "banner"
	} catch {
		return "banner"
	}
}

/** The server has no storage to read, so every page starts with the banner in its markup. */
export function getServerPromoMode(): PromoMode {
	return "banner"
}

export function subscribePromo(listener: () => void): () => void {
	listeners.add(listener)

	// Another tab closing the promo should close this one too. `storage` only
	// fires for writes made elsewhere, which is exactly the case handled here.
	const onStorage = (event: StorageEvent) => {
		if (event.key !== STICKER_SHEET_PROMO_KEY) return
		memory = isMode(event.newValue) ? event.newValue : "banner"
		emit()
	}

	window.addEventListener("storage", onStorage)
	return () => {
		listeners.delete(listener)
		window.removeEventListener("storage", onStorage)
	}
}

export function setPromoMode(mode: PromoMode): void {
	memory = mode
	try {
		window.localStorage.setItem(STICKER_SHEET_PROMO_KEY, mode)
	} catch {
		// Private mode, a full quota, or storage disabled: the in-memory value
		// still carries this tab, and the next page starts clean.
	}
	// The boot script uses the same attribute to hide the server-rendered
	// banner before paint, so keep it in step with what React is doing.
	document.documentElement.dataset.promo = mode
	emit()
}

export type { PromoMode }
export { STICKER_SHEET_PROMO_KEY }
