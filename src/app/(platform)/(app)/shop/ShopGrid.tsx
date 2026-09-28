"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { Gato } from "@/components/platform/art"
import { IconCheck, IconCoin } from "@/components/platform/icons"
import { cx, Panel } from "@/components/platform/ui"
import type { ShopItemView } from "@/lib/shop"
import { useStore } from "@/lib/store"

/**
 * The shelves, in the order they read on screen, mapped to the categories the
 * ledger actually enforces. `PRINTER` is its own shelf because it is the only
 * one banked coins may be spent on — the distinction is not cosmetic, it is the
 * forced-savings rule.
 */
const CATEGORIES = [
  { label: "All", match: null },
  { label: "Printers", match: "PRINTER" },
  { label: "Upgrades", match: "PRINTER_UPGRADE" },
  { label: "Consumables", match: "CONSUMABLE" },
  { label: "Everything else", match: "MISC" },
] as const

export function ShopGrid({ items: all }: { items: readonly ShopItemView[] }) {
  const router = useRouter()
  const { coins, printerFund } = useStore()
  const [cat, setCat] = useState<string>("All")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const items = useMemo(() => {
    const shelf = CATEGORIES.find((c) => c.label === cat)
    return !shelf?.match ? all : all.filter((i) => i.category === shelf.match)
  }, [all, cat])

  /**
   * Buying is a request, not a transaction the browser can settle.
   *
   * The server takes the coins inside one locked transaction and the order
   * lands PENDING for someone to fulfil, so there is nothing to do optimistically
   * here beyond refusing to double-fire — a second click while the first is in
   * the air is how somebody ends up with two printers.
   */
  async function buy(item: ShopItemView) {
    if (busy) return
    setBusy(item.id)
    setError(null)
    try {
      const res = await fetch("/api/shop/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shopItemId: item.id, quantity: 1 }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(payload.error?.message ?? `That did not go through (${res.status})`)
        return
      }
      router.refresh()
    } catch {
      setError("That did not go through")
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
        {CATEGORIES.map(({ label: c }) => (
          <button
            key={c}
            type="button"
            onClick={() => setCat(c)}
            aria-pressed={cat === c}
            className={cx(
              "label rounded-full border-2 px-4 py-1.5 transition-colors",
              cat === c
                ? "border-navy bg-navy text-white"
                : "border-line text-navy-soft hover:border-navy hover:text-navy",
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {error && (
        <p
          role="alert"
          className="mb-5 rounded-xl border-2 border-coral bg-cream px-4 py-3 text-[0.9rem] font-semibold text-coral-deep"
        >
          {error}
        </p>
      )}

      <ul className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-3">
        {items.map((item) => {
          const has = item.ownedCount > 0
          const out = item.stock !== null && item.stock <= 0
          // Banked coins are legal tender for a printer and for nothing else,
          // so what you can afford depends on what you are buying. Without this
          // the shop would offer to sell someone a hoodie out of their savings.
          const purse = item.category === "PRINTER" ? printerFund : coins
          const afford = purse >= item.priceCredits
          return (
            <Panel
              key={item.id}
              as="li"
              tone="line"
              radius={20}
              className="group flex flex-col overflow-hidden bg-paper"
            >
              <div className="relative grid aspect-[4/3] place-items-center bg-cream/70 p-3">
                {/* The photo staff set on the item; until there is one, gato
                    minding a box of parts, so the shelf never shows a hole. */}
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- staff paste any host into the item's image field
                  <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-contain" />
                ) : (
                  <Gato pose="box" sizes="200px" className="sticker-shadow h-full w-auto max-w-full" />
                )}
                {item.stock !== null && item.stock > 0 && item.stock <= 3 && (
                  <span className="label absolute top-2.5 left-2.5 rounded-full bg-coral px-2.5 py-1 text-white">
                    Low stock
                  </span>
                )}
                {out && (
                  <span className="label absolute top-2.5 left-2.5 rounded-full bg-navy-soft px-2.5 py-1 text-white">
                    Sold out
                  </span>
                )}
                <button
                  type="button"
                  disabled={out || item.locked || !afford || busy !== null}
                  onClick={() => void buy(item)}
                  className={cx(
                    "label absolute bottom-3 left-3 flex items-center gap-1.5 rounded-xl border-2 px-3.5 py-2 transition-all duration-150",
                    "opacity-100 sm:translate-y-1.5 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100 sm:group-focus-within:translate-y-0 sm:group-focus-within:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100",
                    has
                      ? "border-teal-deep bg-teal text-white"
                      : out || !afford
                        ? "cursor-not-allowed border-line bg-cream text-navy-soft"
                        : "border-teal-deep bg-teal-mid text-navy hover:bg-teal hover:text-white",
                  )}
                >
                  {busy === item.id ? (
                    "Ordering…"
                  ) : has ? (
                    <>
                      <IconCheck className="text-sm" strokeWidth={3} /> Ordered
                    </>
                  ) : out ? (
                    "Sold out"
                  ) : item.locked ? (
                    "Locked"
                  ) : afford ? (
                    "Buy"
                  ) : (
                    "Not enough"
                  )}
                </button>
              </div>

              <div className="flex flex-1 flex-col gap-1.5 px-4 py-3.5">
                <h2 className="text-[0.98rem] leading-tight font-extrabold text-navy">{item.name}</h2>
                <p className="flex-1 text-[0.82rem] leading-snug text-navy-soft">
                  {item.lockReason ?? item.description}
                </p>
                <p className="mt-1 flex items-center gap-1.5">
                  <IconCoin className="text-[1.15rem] text-orange" />
                  <span
                    className={cx(
                      "text-[1.05rem] leading-none font-extrabold tabular-nums",
                      afford ? "text-navy" : "text-navy-soft",
                    )}
                  >
                    {item.priceCredits}
                  </span>
                </p>
              </div>
            </Panel>
          )
        })}
      </ul>

      <p className="hand mt-8 text-center text-[0.86rem] text-navy-soft">
        you have <span className="font-bold text-orange-ink tabular-nums">{coins}</span> coins. every hour you log past
        your tier banks five more.
      </p>
    </>
  )
}
