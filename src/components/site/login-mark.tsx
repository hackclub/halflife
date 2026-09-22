/**
 * The way back in, pinned to the painting's top-right corner.
 *
 * It answers the flag across the top edge: the Hack Club flag hangs from the
 * top-left, this hangs from the top-right, and the dateline centres between
 * them. Same material as the dateline — flat ink, square corners, no border,
 * no shadow, the one container this system has — so it reads as a third mark
 * mounted on the scene rather than as a nav bar that crept in.
 *
 * Paper on ink rather than a cyan block. Cyan is the sign-up CTA's colour one
 * viewport below, and the two are not equals: signing up is what the page is
 * for, logging in is for the people it has already persuaded. The accent
 * arrives only on hover, as it does on every other link on this ink.
 *
 * Two vertical positions, following the dateline's own switch at 830px.
 * - At 830 and up the dateline sits at `top-3`, one line tall, and this takes
 *   the same row: `top-3`, the same `py-2.5`, the same 16px line, so the two
 *   plates share a top edge and a height. The dateline is 578px wide at most
 *   and centred, so the gap between them is (vw - 578) / 2 - 12 - this plate's
 *   width; at 830 that is about 30px, and it only opens from there.
 * - Below 830 the dateline drops to 3.25rem to clear the flag, and this does
 *   what the flag does instead: hangs at `top-1` and stays under 2.52rem tall,
 *   so the dateline clears it by the same 11.6px it clears the flag by.
 *
 * A plain anchor, not `next/link`: /dashboard is under a different root
 * layout, so the navigation is a full page load either way. Signed out,
 * /dashboard sends you to sign in; signed in, straight to the trail.
 */
export default function LoginMark() {
  return (
    <a
      href="/dashboard"
      className="absolute top-1 right-1 z-20 bg-hl-ink px-3.5 py-1.5 font-display font-bold leading-snug text-hl-paper transition-colors hover:text-hl-cyan focus-visible:text-hl-cyan min-[830px]:top-3 min-[830px]:right-3 min-[830px]:px-5 min-[830px]:py-2.5"
      style={{ fontSize: "clamp(0.875rem, 3.6vw, 1rem)" }}
    >
      log in
    </a>
  );
}
