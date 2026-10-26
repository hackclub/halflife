/**
 * Every picture the platform shows that is not a user's own upload lives here, and every one of them is real: the programme's painted stickers and gato characters from `public/art` and `public/brand`, the makers' own photos of the printers, and the starter projects' renders from their repos. Nothing is drawn in code, and nothing falls back to a drawing: a slot with no picture shows no picture.
 *
 * Everything is imported rather than named by path: the URL carries a hash of the file, so a repainted sticker is never served from a stale cache, and `next/image` gets the intrinsic size to hand the browser the width it is shown at rather than the 3000px source.
 */

import Image, { type StaticImageData } from "next/image"
import gatoHead from "../../../public/art/extras/gatohead.png"
import bambuA1Photo from "../../../public/art/printers/bambu-a1.webp"
import bambuA1MiniPhoto from "../../../public/art/printers/bambu-a1-mini.webp"
import bambuP1sPhoto from "../../../public/art/printers/bambu-p1s.webp"
import centauri2Photo from "../../../public/art/printers/elegoo-centauri-2.webp"
import mars5Photo from "../../../public/art/printers/elegoo-mars-4.webp"
import neptune4Photo from "../../../public/art/printers/elegoo-neptune-4.webp"
import ender3V3SePhoto from "../../../public/art/printers/ender-3-v3-se.webp"
import monopriceCncPhoto from "../../../public/art/printers/monoprice-cnc.webp"
import displaysPhoto from "../../../public/art/starters/displays/leds-2.jpg"
import merblRender from "../../../public/art/starters/merbl.png"
import midiRender from "../../../public/art/starters/midi.png"
import starbieRender from "../../../public/art/starters/starbie.webp"
import breadboardPainting from "../../../public/art/weeks/breadboard.png"
import cadPainting from "../../../public/art/weeks/cad.png"
import displayPainting from "../../../public/art/weeks/display.png"
import musicPainting from "../../../public/art/weeks/music.png"
import pcbPainting from "../../../public/art/weeks/PCB.png"
import gatoBox from "../../../public/brand/gato/boxx.png"
import gatoConfused from "../../../public/brand/gato/confused.png"
import gatoSchematic from "../../../public/brand/gato/schematic.png"

/* ------------------------------------------------------------------ *
 * Filters. Mounted once, referenced by .sketch / .torn in globals.css
 * ------------------------------------------------------------------ */
export function SketchDefs() {
	return (
		<svg aria-hidden="true" focusable="false" style={{ height: 0, overflow: "hidden", position: "absolute", width: 0 }}>
			<defs>
				<filter height="124%" id="hl-wobble" width="124%" x="-12%" y="-12%">
					<feTurbulence baseFrequency="0.018" numOctaves="3" result="n" seed="7" type="fractalNoise" />
					<feDisplacementMap in="SourceGraphic" in2="n" scale="4.2" xChannelSelector="R" yChannelSelector="G" />
				</filter>
				<filter height="124%" id="hl-wobble-2" width="124%" x="-12%" y="-12%">
					<feTurbulence baseFrequency="0.022" numOctaves="3" result="n" seed="21" type="fractalNoise" />
					<feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" />
				</filter>
				<filter height="128%" id="hl-wobble-3" width="128%" x="-14%" y="-14%">
					<feTurbulence baseFrequency="0.034" numOctaves="2" result="n" seed="43" type="fractalNoise" />
					<feDisplacementMap in="SourceGraphic" in2="n" scale="3.4" xChannelSelector="R" yChannelSelector="G" />
				</filter>
				<filter height="150%" id="hl-tear" width="120%" x="-10%" y="-25%">
					<feTurbulence baseFrequency="0.02 0.11" numOctaves="3" result="n" seed="11" type="fractalNoise" />
					<feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G" />
				</filter>
				<filter height="140%" id="hl-tear-soft" width="120%" x="-10%" y="-20%">
					<feTurbulence baseFrequency="0.03 0.09" numOctaves="2" result="n" seed="31" type="fractalNoise" />
					<feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" />
				</filter>
			</defs>
		</svg>
	)
}

/* ------------------------------------------------------------------ *
 * Gato
 * ------------------------------------------------------------------ */

const GATO: Record<"head" | "box" | "confused" | "schematic", StaticImageData> = {
	box: gatoBox,
	confused: gatoConfused,
	head: gatoHead,
	schematic: gatoSchematic,
}

/**
 * The programme's fox, as its artist painted it. `head` is the mark – the face alone, for the title card, the HQ badge and the journal's watermark; the others are whole-body stickers for a slot that wants a character.
 *
 * The caller sizes it, and names both axes: `w-… h-auto` to size by width, `h-… w-auto` by height. `object-contain` keeps a box of any shape from stretching it. Neither axis defaults here, because two heights in one class list are settled by whichever Tailwind emits last. Silent by default: every place it sits is beside words that already say what it would.
 */
export function Gato({
	pose = "head",
	className,
	sizes,
	alt = "",
}: {
	pose?: keyof typeof GATO
	className?: string
	/** The rendered width, for `next/image`. */
	sizes: string
	alt?: string
}) {
	return <Image alt={alt} className={`object-contain ${className ?? ""}`} sizes={sizes} src={GATO[pose]} />
}

/* ------------------------------------------------------------------ *
 * Week paintings
 * ------------------------------------------------------------------ */

/**
 * The programme's own painted stickers, one per theme, from `public/art/weeks` – the same files the landing page's "how does it work?" plate shows. Each source is a 3000px square of 2-4 MB, which is why this goes through `next/image` and names the size it is shown at. A theme with no painting shows nothing rather than a stand-in.
 */
const WEEK_PAINTINGS: Partial<{ [_: string]: StaticImageData }> = {
	"Breadboard computer": breadboardPainting,
	CAD: cadPainting,
	Displays: displayPainting,
	Music: musicPainting,
	PCB: pcbPainting,
	// The warm-up has no theme to paint. It is "your own idea", which is the Gato that stands for that on onboarding's custom-project card.
	"Warm Up": gatoSchematic,
}

export function WeekPainting({
	theme,
	className,
	sizes,
	alt = `${theme} illustration`,
}: {
	theme: string
	className?: string
	/** The rendered width, for `next/image`. */
	sizes: string
	alt?: string
}) {
	const painting = WEEK_PAINTINGS[theme]
	if (!painting) return null
	return (
		<span className={`relative block ${className ?? ""}`}>
			<Image alt={alt} className="object-contain" fill sizes={sizes} src={painting} />
		</span>
	)
}

/* ------------------------------------------------------------------ *
 * The grand prize
 * ------------------------------------------------------------------ */

/**
 * The real machines, as their makers photograph them on the product page each goal links to. Keyed by goal id, since two bed-slingers are not the same printer once it is a photo.
 *
 * Each file is the maker's shot trimmed to the machine and set on white at 560px square, the machine standing on a common floor so a row of them lines up. That is the largest place one is shown – the onboarding prize, at 280px – at twice the pixels, and `next/image` cuts it down for the small tiles.
 */
const PRINTER_PHOTOS: Partial<{ [_: string]: StaticImageData }> = {
	"bambu-a1": bambuA1Photo,
	"bambu-a1-mini": bambuA1MiniPhoto,
	"bambu-p1s": bambuP1sPhoto,
	"elegoo-centauri-2": centauri2Photo,
	"elegoo-mars-4": mars5Photo,
	"elegoo-neptune-4": neptune4Photo,
	"ender-3-v3-se": ender3V3SePhoto,
	"monoprice-cnc": monopriceCncPhoto,
}

/**
 * The photo on its white ground, in a box the caller sizes. A goal with no photo shows an empty white tile – the catalogue has one for every machine, so that only happens to a goal added without one.
 *
 * `alt` is empty by default: everywhere this sits, the printer's name is already written beside it, and reading it out twice helps nobody.
 */
export function PrinterPhoto({
	id,
	className,
	sizes,
	alt = "",
}: {
	id: string
	className?: string
	/** The rendered width, for `next/image`. */
	sizes: string
	alt?: string
}) {
	const photo = PRINTER_PHOTOS[id]
	return (
		<span className={`relative block overflow-hidden bg-white ${className ?? ""}`}>
			{photo && <Image alt={alt} className="object-contain" fill sizes={sizes} src={photo} />}
		</span>
	)
}

/* ------------------------------------------------------------------ *
 * Starter projects
 * ------------------------------------------------------------------ */

/**
 * Each starter project's own render, from its repo's `Renders` folder, trimmed to the board with its transparency kept. Displays has no board of its own, so it shows the RGB LED photo from its first guide. Keyed by starter id; a starter with no render shows nothing.
 */
const STARTER_RENDERS: Partial<{ [_: string]: StaticImageData }> = {
	displays: displaysPhoto,
	merbl: merblRender,
	midi: midiRender,
	starbie: starbieRender,
}

export function StarterRender({
	id,
	className,
	sizes,
	alt = "",
}: {
	id: string
	className?: string
	/** The rendered width, for `next/image`. */
	sizes: string
	alt?: string
}) {
	const render = STARTER_RENDERS[id]
	if (!render) return null
	return (
		<span className={`relative block ${className ?? ""}`}>
			<Image alt={alt} className="object-contain" fill sizes={sizes} src={render} />
		</span>
	)
}
