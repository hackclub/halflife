import { ANNOUNCEMENT } from "@/lib/site/content"

/**
 * The dateline, laid on the painting.
 *
 * It is a plate — flat ink, square corners, no border, no shadow, the one
 * container this system has — sized to its own words rather than to the
 * screen. A strip that spans the screen to carry 350px of sentence is mostly
 * ground, and at the top of a page that reads as chrome: a cookie bar, a
 * shipping notice, something to dismiss. Sized to its words it reads as what
 * it is, a label plate mounted on the scene.
 *
 * Absolutely positioned inside the hero rather than standing above it. In
 * flow it pushed `bg.png` down and took a bite out of the fold that the hero
 * then had to subtract back; on the painting it costs the fold nothing, the
 * hero is a plain `100svh` again, and the picture starts at the top of the
 * screen where it was composed to start.
 *
 * Ink on the painting's top band is 3.74:1, so the plate reads as its own
 * material at every width without a rule drawn around it. Paper on ink is
 * 12.85:1 and cyan on ink 8.96:1.
 *
 * Not sticky, for the reason the flag is not fixed: this page scrolls through
 * four rooms with their own grounds, and a plate riding over the carousel and
 * the FAQ would be an overlay rather than a mark on the hero.
 *
 * One surface, one accent. The email slot is the standing lesson on what
 * happens when a device is borrowed into a box this size: five decorative
 * systems at a scale where none of them resolved. So this is one plate, one
 * sentence, and the date in cyan — the accent carrying the one fact the plate
 * exists for rather than ornamenting it. Cyan is also the CTA's colour, a
 * viewport below, and the two do not compete: the button is a filled block
 * and this is 90px of type at the top edge.
 *
 * The plate now carries a second fact — where to submit — and it is marked by
 * an underline rather than a second block of accent, so the one-accent rule
 * survives the sentence growing. The anchor is the footer's link idiom
 * unchanged (paper, a quarter-opacity rule, cyan on hover), which is the same
 * ink ground, so a link reads the same in both places.
 *
 * It was static and not a link for as long as there was nowhere for it to go.
 * The submission form is a real destination, so the last word is an anchor;
 * the rest of the sentence stays plain, because the date is still something
 * you read rather than something you click.
 */
export default function AnnouncementBanner() {
  return (
    // The positioning box spans the hero so the plate can centre on the same
    // line the painting centres on, and carries the gutter that keeps the
    // plate off the screen edges on a phone. It has no ground: what shows
    // either side of the plate is the painting.
    //
    // `pointer-events-none` is load-bearing, not tidiness. This box is
    // invisible but it is still a hit target, and on a wide screen it crosses
    // the Hack Club flag — which is a link — at exactly the rows the flag
    // occupies. Without it the flag's lower two thirds stop being clickable.
    // The plate takes its events back so the sentence stays selectable.
    <div className="pointer-events-none absolute inset-x-0 top-[3.25rem] z-20 flex justify-center px-3 min-[830px]:top-3">
      {/* Two vertical positions, because below about 830px of viewport the
          plate and the flag want the same row and the plate is too wide to
          move sideways out of the way.

          The narrow one is derived, not chosen. The flag hangs at `top-1`
          from a box whose width is `clamp(6.5rem, 11vw, 10rem)`, and below
          945px that clamp is pinned at its 6.5rem floor — so the flag's
          height there is a constant 6.5 x 184/526 = 2.27rem, putting its
          bottom edge at 2.52rem. 3.25rem clears it by 11.6px at every width
          this branch covers.

          The switch is at 830px, and it is the one-line plate that puts it
          there. On the flag's own rows the only thing keeping the two apart
          is the plate being narrow enough to centre clear of it, and set on
          one line the plate is 578px wide — 33.62em of sentence at the 16px
          ceiling, plus 40px of padding. Below 945 the flag is pinned at its
          6.5rem floor, so its right edge is a constant 108px and
          (vw - 578) / 2 >= 108 first holds at 794, which is a near miss
          rather than a decision. 830 makes it an 18px gap. Above 945 the flag
          grows with the viewport at 11vw while the ground either side of the
          plate grows at 50vw, so the clearance only opens from there. */}
      <div className="pointer-events-auto max-w-[24.375rem] bg-hl-ink px-5 py-2.5 min-[624px]:max-w-none">
        {/* One line wherever the sentence fits, two where it cannot.

            The whole sentence measures 33.62em set in Open Sans — 13.40 for
            the lead, 7.59 for the date at its 600 weight, 10.48 for the tail
            and 2.15 for the link — so at the 16px ceiling it wants 538px of
            text, 578 with the plate's padding and 602 with the gutter either
            side. `min-[624px]` is that number with 22px of slack, which is
            there for the fallback face being a shade wider than Open Sans
            while the real one loads: a `nowrap` plate that outgrew the gutter
            would scroll the whole page sideways for a frame.

            Below that width the 390px cap stands and the sentence takes two
            lines. Uncapped it would be a strip spanning the phone to carry
            one sentence, which is the cookie-bar reading the plate exists to
            avoid, and `text-balance` is what keeps the second line a fair
            share of the sentence rather than "here" stranded under a full
            one.

            The fluid size is what holds that branch at two lines rather than
            three: the plate is content-sized below 414px of viewport, where
            the type shrinking is what keeps the count down, and `3.6vw`
            reaches the 16px ceiling by 444 — well inside the capped branch,
            so the one-line branch is always set at the full 16. */}

      </div>
    </div>
  )
}
