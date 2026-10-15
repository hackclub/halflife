import BuildCarousel from "@/components/site/build-carousel"
import Faq from "@/components/site/faq"
import Hero from "@/components/site/hero"
import Process from "@/components/site/process"
import SiteFooter from "@/components/site/site-footer"

export default function Page() {
	return (
		<>
			<a
				className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:bg-hl-cyan focus:px-4 focus:py-2 focus:font-semibold focus:text-hl-ink"
				href="#how-it-works"
			>
				Skip to how it works
			</a>
			<main className="flex-1">
				{/* The hero and "how does it work?" are one room, and this is the box
            that makes that true rather than merely coordinated.

            Both the steel ground and the tiled ground pattern live here, on
            one element spanning both sections, for two reasons.

            The first is the handoff. `bg.png` dissolves over its own bottom
            28% into whatever the room is standing on, so the ground has to
            already be under the painting for the fade to have something to
            hand off to. Put the tiling on the process section alone and the
            dissolve resolves into flat `hl-blue-deep`, then the texture
            switches on further down at a section boundary the reader cannot
            see the reason for – two handoffs, one of them a hard line, where
            the painting was masked to make a single soft one.

            The second is phase. The tile is a `repeat` at a viewport-derived
            size, so a box starts the lattice at its own top edge: two boxes
            stacked cut a partial row at the seam at every viewport height, and
            because the tile's height is a fraction of a `clamp()`ed width
            there is no size that ever lines them up. One box has one phase.

            `isolate` is what keeps the ground's own negative-index layer
            inside this box; without a stacking context here it would escape to
            the root and paint behind this element's `bg-hl-blue-deep`, which
            is to say nowhere.

            The sections below keep their own grounds: the carousel and the FAQ
            are different rooms and are supposed to read as such. */}
				<div className="hl-ground-tile isolate bg-hl-blue-deep">
					<Hero />
					<Process />
				</div>
				<BuildCarousel />
				<Faq />
			</main>
			<SiteFooter />
		</>
	)
}
