import { GUIDE as filament } from "./filament"
import { GUIDE as leds } from "./leds"
import { GUIDE as matrices } from "./matrices"
import { GUIDE as neopixels } from "./neopixels"
import { GUIDE as oled } from "./oled"
import { GUIDE as segments } from "./segments"
import { GUIDE as tft } from "./tft"

/** Each display starter's guide body, as Markdown, keyed by its slug in `config/display-starters.ts`. */
export const DISPLAY_GUIDES: { readonly [_: string]: string } = Object.freeze({
	filament,
	leds,
	matrices,
	neopixels,
	oled,
	segments,
	tft,
})
