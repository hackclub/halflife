import Wordmark from "@/components/site/wordmark"
import { FOOTER_COLUMNS } from "@/lib/site/content"

export default function SiteFooter() {
	return (
		<footer className="mt-auto bg-hl-ink text-hl-paper">
			<div className="mx-auto max-w-[1615px] px-4 pt-16 pb-10 sm:px-8 min-[1180px]:px-[3.4vw] min-[1180px]:pt-24">
				<div className="grid gap-12 min-[900px]:grid-cols-[minmax(0,1.15fr)_repeat(3,minmax(0,0.6fr))] min-[900px]:gap-10">
					<div className="max-w-sm">
						<Wordmark as="p" className="text-hl-cyan!" fontSize="clamp(2.75rem, 7vw, 4.25rem)" />
						<p className="mt-5 text-base leading-relaxed text-hl-paper">{"made with <3 by teenagers at Hack Club"}</p>
						<p className="mt-4 text-sm leading-relaxed text-hl-paper-soft">
							Hack Club is a 501(c)(3) nonprofit (EIN 81-2908499) that helps teenagers around the world build technical
							projects.
						</p>
					</div>

					{FOOTER_COLUMNS.map(column => (
						<nav aria-label={column.heading} key={column.heading}>
							{/* 0.95rem, not text-xs: Masterpiece's cap height is 0.568em against
                  Urbanist's ~0.71, so 12px would read a fifth smaller than the
                  label it replaces. This lands the caps at the same height. */}
							<h2 className="font-tagline text-[0.95rem] uppercase tracking-[0.18em] text-hl-cyan">{column.heading}</h2>
							<ul className="mt-5 space-y-3">
								{column.links.map(link => (
									<li key={link.label}>
										<a
											className="text-base text-hl-paper underline decoration-hl-paper/25 decoration-2 underline-offset-4 transition-colors hover:text-hl-cyan hover:decoration-hl-cyan focus-visible:text-hl-cyan"
											href={link.href}
										>
											{link.label}
										</a>
									</li>
								))}
							</ul>
						</nav>
					))}
				</div>
			</div>
		</footer>
	)
}
