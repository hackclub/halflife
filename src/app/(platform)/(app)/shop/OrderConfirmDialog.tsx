"use client"

import { useState } from "react"
import { IconCoin } from "@/components/platform/icons"
import { Acknowledgement } from "@/components/platform/modals/Acknowledgement"
import { Modal, ModalTitle } from "@/components/platform/modals/Modal"
import { Button, LinkButton } from "@/components/platform/ui"
import type { ShopItemView } from "@/lib/shop"

/**
 * The last step before an order is sent: a maker confirms the mailing address staff will ship to.
 *
 * The address itself is encrypted at rest and never selected into anything a browser sees, so this asks them to check it in Hack Club Auth rather than showing a copy here. The order cannot be placed until the box is ticked.
 */
export function OrderConfirmDialog({
	item,
	onCancel,
	onConfirm,
}: {
	item: ShopItemView
	onCancel(): void
	onConfirm(): void
}) {
	const [checked, setChecked] = useState(false)

	return (
		<Modal
			accent="var(--color-teal)"
			eyebrow="Before you order"
			footer={
				<>
					<Button onClick={onCancel} variant="ghost">
						Not yet
					</Button>
					<Button disabled={!checked} onClick={onConfirm} variant="teal">
						Place order
					</Button>
				</>
			}
			onClose={onCancel}
			open
			size="md"
		>
			<ModalTitle sub="We ship to the mailing address on your Hack Club account. It&rsquo;s kept private and never shown on this page, so check it there before you place this order.">
				Check your mailing address
			</ModalTitle>

			<div className="rounded-xl border-2 border-dashed border-line bg-white/60 px-4 py-3">
				<p className="label text-navy-faint">Your order</p>
				<p className="mt-1 flex items-center justify-between gap-3">
					<span className="min-w-0 text-[0.95rem] font-extrabold text-navy">{item.name}</span>
					<span className="flex shrink-0 items-center gap-1.5 text-[0.95rem] font-extrabold text-navy tabular-nums">
						<IconCoin className="text-[1.1rem] text-orange" />
						{item.priceCredits}
					</span>
				</p>
			</div>

			<div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
				<LinkButton
					href="https://identity.hackclub.com"
					rel="noopener noreferrer"
					size="sm"
					target="_blank"
					variant="outline"
				>
					Open Hack Club Auth
				</LinkButton>
				<p className="hand text-[0.82rem] leading-snug text-navy-soft">
					If it&rsquo;s missing or out of date, update it there first.
				</p>
			</div>

			<div className="mt-3">
				<Acknowledgement checked={checked} onChange={setChecked}>
					I&rsquo;ve checked my mailing address in Hack Club Auth and it&rsquo;s correct.
				</Acknowledgement>
			</div>
		</Modal>
	)
}
