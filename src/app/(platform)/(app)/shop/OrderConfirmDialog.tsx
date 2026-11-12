"use client"

import { useState } from "react"
import { IconCoin } from "@/components/platform/icons"
import { Acknowledgement } from "@/components/platform/modals/Acknowledgement"
import { Modal, ModalTitle } from "@/components/platform/modals/Modal"
import { Button, LinkButton } from "@/components/platform/ui"
import { cx } from "@/lib/cx"
import { ShopDeliveryPreference } from "@/lib/enums"
import type { ShopItemView } from "@/lib/shop"

/**
 * The last step before an order is sent: a maker chooses whether the item is posted to them or its value comes as an HCB grant card, and confirms the address staff would ship to.
 *
 * The address itself is encrypted at rest and never selected into anything a browser sees, so the shipping path asks them to check it in Hack Club Auth rather than showing a copy here. Neither path can be placed until its own box is ticked, so an order never reaches staff without an explicit choice behind it.
 */
export function OrderConfirmDialog({
	item,
	onCancel,
	onConfirm,
}: {
	item: ShopItemView
	onCancel(): void
	onConfirm(deliveryPreference: ShopDeliveryPreference): void
}) {
	const [delivery, setDelivery] = useState<ShopDeliveryPreference | null>(null)
	const [addressChecked, setAddressChecked] = useState(false)
	const [grantChecked, setGrantChecked] = useState(false)

	const ready =
		delivery === ShopDeliveryPreference.SHIP
			? addressChecked
			: delivery === ShopDeliveryPreference.GRANT_CARD
				? grantChecked
				: false

	return (
		<Modal
			accent="var(--color-teal)"
			eyebrow="Before you order"
			footer={
				<>
					<Button onClick={onCancel} variant="ghost">
						Not yet
					</Button>
					<Button disabled={!ready} onClick={() => delivery && onConfirm(delivery)} variant="teal">
						Place order
					</Button>
				</>
			}
			onClose={onCancel}
			open
			size="md"
		>
			<ModalTitle sub="Pick one before you order. The team who fulfil it see your choice, and you can cancel while the order is still pending.">
				How should we get this to you?
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

			<fieldset className="mt-4 grid gap-2">
				<legend className="label mb-2 text-navy-faint">Delivery</legend>
				<DeliveryOption
					checked={delivery === ShopDeliveryPreference.SHIP}
					description="We post it to the mailing address on your Hack Club account."
					label="Ship it to me"
					onSelect={() => setDelivery(ShopDeliveryPreference.SHIP)}
					value="ship"
				/>
				<DeliveryOption
					checked={delivery === ShopDeliveryPreference.GRANT_CARD}
					description="We put its value on an HCB grant card so you can buy it yourself. Staff arrange the card after you order."
					label="Send a grant card instead"
					onSelect={() => setDelivery(ShopDeliveryPreference.GRANT_CARD)}
					value="grant-card"
				/>
			</fieldset>

			{delivery === ShopDeliveryPreference.SHIP && (
				<div className="mt-4">
					<p className="text-[0.88rem] leading-relaxed text-navy-soft">
						We ship to the mailing address on your Hack Club account. It&rsquo;s kept private and never shown on this
						page, so check it there before you place this order.
					</p>
					<div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
						<LinkButton
							href="https://auth.hackclub.com"
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
						<Acknowledgement checked={addressChecked} onChange={setAddressChecked}>
							I&rsquo;ve checked my mailing address in Hack Club Auth and it&rsquo;s correct.
						</Acknowledgement>
					</div>
				</div>
			)}

			{delivery === ShopDeliveryPreference.GRANT_CARD && (
				<div className="mt-4">
					<p className="text-[0.88rem] leading-relaxed text-navy-soft">
						Instead of posting the item, we send its value as an HCB grant card. The card may not stretch to this exact
						item if prices differ where you are, and staff arrange it after you order.
					</p>
					<div className="mt-3">
						<Acknowledgement checked={grantChecked} onChange={setGrantChecked}>
							I understand I&rsquo;ll get a grant card instead of the item being shipped.
						</Acknowledgement>
					</div>
				</div>
			)}
		</Modal>
	)
}

/** One of the two ways an order can reach its buyer, drawn as a card so the choice is readable at a glance. */
function DeliveryOption({
	checked,
	description,
	label,
	onSelect,
	value,
}: {
	checked: boolean
	description: string
	label: string
	onSelect(): void
	value: string
}) {
	return (
		<label
			className={cx(
				"flex cursor-pointer items-start gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-violet has-[input:focus-visible]:ring-offset-2",
				checked ? "border-teal-deep bg-teal-mid/40" : "border-line hover:border-navy-soft",
			)}
		>
			<input
				checked={checked}
				className="sr-only"
				name="shop-delivery"
				onChange={onSelect}
				type="radio"
				value={value}
			/>
			<span
				aria-hidden="true"
				className={cx(
					"mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-full border-2 transition-colors",
					checked ? "border-teal-deep" : "border-line-strong",
				)}
			>
				{checked && <span className="size-2 rounded-full bg-teal-deep" />}
			</span>
			<span className="min-w-0">
				<span className="block text-[0.92rem] font-extrabold text-navy">{label}</span>
				<span className="mt-0.5 block text-[0.82rem] leading-snug text-navy-soft">{description}</span>
			</span>
		</label>
	)
}
