/**
 * Week 4's starter projects: one per kind of display, easiest first.
 *
 * Each is a guide rather than a single board, so unlike `STARTER_PROJECTS` in `./onboarding.ts` there is no repo and no render here. The guide bodies live in `lib/starters/guides/`, generated from the "A Beginner's Guide to Displays" doc, and every photo is a freely licensed Wikimedia Commons file credited where it is shown.
 *
 * `hours` is a rough first-build estimate for a beginner following the guide, not a promise or a requirement.
 */

export type DisplayLevel = "Easiest" | "Easy" | "Medium"

export interface DisplayPhoto {
	readonly alt: string
	/** Author, licence and Commons file page, as the photo's credit line. */
	readonly credit: { readonly author: string; readonly licence: string; readonly url: string }
	readonly file: string
}

export interface DisplayStarter {
	readonly hours: number
	/** The guide's own opening, shown under the title. */
	readonly lead: string
	readonly level: DisplayLevel
	/** What goes on the board, for the details panel. */
	readonly parts: readonly string[]
	readonly photo: DisplayPhoto
	/** One line, for the strip and the page's description. */
	readonly short: string
	readonly slug: string
	readonly title: string
}

export const DISPLAY_STARTERS = Object.freeze([
	{
		hours: 3,
		lead: 'The humble LED is the simplest "display" to start with. Use it for status lights, button feedback and colour mixing, and with a few tricks it grows into dice, clocks and cubes.',
		level: "Easiest",
		parts: ["5mm LEDs", "RGB LED", "Resistors", "74HC595"],
		photo: {
			alt: "Close-up of a clear 5 mm RGB LED with four legs and three tiny coloured chips inside",
			credit: {
				author: "Mister rf",
				licence: "CC BY-SA 4.0",
				url: "https://commons.wikimedia.org/wiki/File:LED_5mm_RGB.jpg",
			},
			file: "leds-2.jpg",
		},
		short: "Blink, fade and mix colours with the most basic light there is.",
		slug: "leds",
		title: "5mm LEDs",
	},
	{
		hours: 5,
		lead: 'LED filaments are thin glowing rods and noodles that look like the wire in an old-school light bulb. Use them for lamps, neon-style signs, "floating" seven-segment clocks, or anywhere you want a solid line of warm light instead of dots.',
		level: "Easy",
		parts: ["3 V LED filament", "AO3400A MOSFET", "56 Ω resistors"],
		photo: {
			alt: "A clear Philips E27 LED filament bulb with four orange filaments standing inside the glass",
			credit: {
				author: "W.carter",
				licence: "CC BY-SA 4.0",
				url: "https://commons.wikimedia.org/wiki/File:A_clear_Philips,_E27,_4.3W,_LED_filament_light_bulb,_upright.jpg",
			},
			file: "filament-1.jpg",
		},
		short: "Bend glowing noodles into signs, lamps and floating digits.",
		slug: "filament",
		title: "LED filament",
	},
	{
		hours: 4,
		lead: "7-segment displays are big, bright and readable from across the room. Use them for numbers: clocks, timers, scores and sensor readings.",
		level: "Easy",
		parts: ["TM1637 module", "4-digit display", "EC11 encoder"],
		photo: {
			alt: "A red single-digit 7-segment display showing the number 4 on a breadboard",
			credit: {
				author: "RetroEditor",
				licence: "CC BY-SA 4.0",
				url: "https://commons.wikimedia.org/wiki/File:LED_7_Segment_Display.jpg",
			},
			file: "segments-1.jpg",
		},
		short: "Show numbers big and bright: clocks, timers and scoreboards.",
		slug: "segments",
		title: "7-segment displays",
	},
	{
		hours: 5,
		lead: "NeoPixels are full-colour LEDs that you set one by one, all from a single data pin. Use them for glowing rings, light strips, status lights and colour effects.",
		level: "Easy",
		parts: ["WS2812B ring", "74AHCT125", "1000 µF capacitor"],
		photo: {
			alt: "An addressable LED strip showing a rainbow next to a normal strip that can only show one colour",
			credit: {
				author: "DoyleTheCat",
				licence: "CC BY-SA 4.0",
				url: "https://commons.wikimedia.org/wiki/File:Addressable_LEDs.jpg",
			},
			file: "neopixels-1.jpg",
		},
		short: "Set every LED in a ring or strip to any colour, from one pin.",
		slug: "neopixels",
		title: "NeoPixels",
	},
	{
		hours: 5,
		lead: "An LED matrix is a grid of LEDs you can light one dot at a time. It suits scrolling text, pixel-art faces, clocks and tiny games, and it's readable from across the room.",
		level: "Easy",
		parts: ["MAX7219 4-in-1 module", "Slide pot", "EC11 encoder"],
		photo: {
			alt: "An 8x8 LED matrix block with two of its pins visible underneath",
			credit: {
				author: "oomlout",
				licence: "CC BY-SA 2.0",
				url: "https://commons.wikimedia.org/wiki/File:8x8_Bicolour_LED_Matrix.jpg",
			},
			file: "matrices-1.jpg",
		},
		short: "Scroll text and draw pixel faces on a grid of 64 dots.",
		slug: "matrices",
		title: "LED matrices",
	},
	{
		hours: 5,
		lead: 'OLEDs are small, sharp, high-contrast screens that need only 4 wires. For text, numbers, menus or small pixel-art sprites, a 0.96" OLED is the easiest place to start.',
		level: "Easy",
		parts: ["SSD1306 OLED", "AHT20 sensor", "EC11 encoder"],
		photo: {
			alt: "A 0.96 inch OLED module with GND, VCC, SCL and SDA pins, showing a file list, wired to an Arduino Nano",
			credit: {
				author: "Turbospok",
				licence: "CC BY-SA 4.0",
				url: "https://commons.wikimedia.org/wiki/File:MicroSD_card_connected_to_Arduino_nano_with_OLED_display.jpg",
			},
			file: "oled-1.jpg",
		},
		short: "Put text, menus and tiny sprites on a sharp little screen.",
		slug: "oled",
		title: "OLED screens",
	},
	{
		hours: 8,
		lead: 'Small SPI colour screens take a project from "it blinks" to "it has a real interface". Use them for menus, graphs, game screens and small dashboards. The cheap ones cost a few dollars.',
		level: "Medium",
		parts: ["ST7789 screen", "AO3401A MOSFET", "Pico or XIAO"],
		photo: {
			alt: "A 2.2 inch TFT breakout on a breadboard showing a clock and temperature",
			credit: {
				author: "AaltoFablab",
				licence: "CC BY 2.0",
				url: "https://commons.wikimedia.org/wiki/File:Arduino_2,2%22_TFT_display_(20679950896).jpg",
			},
			file: "tft-1.jpg",
		},
		short: "Draw full-colour graphics, graphs and games over SPI.",
		slug: "tft",
		title: "TFT screens",
	},
] as const satisfies readonly DisplayStarter[])

export type DisplaySlug = (typeof DISPLAY_STARTERS)[number]["slug"]

export const getDisplayStarter = (slug: string): DisplayStarter | undefined =>
	DISPLAY_STARTERS.find(d => d.slug === slug)

/** Where a guide's photos are served from. */
export const displayPhotoSrc = (file: string): string => `/art/starters/displays/${file}`

/**
 * Every guide photo's intrinsic size, so an `<img>` reserves its box before it loads and the guide does not jump as you read it.
 */
export const DISPLAY_PHOTO_SIZES: { readonly [_: string]: readonly [number, number] } = Object.freeze({
	"filament-1.jpg": [1280, 1922],
	"filament-2.jpg": [1280, 235],
	"filament-3.jpg": [1280, 1591],
	"leds-1.png": [960, 1067],
	"leds-2.jpg": [1280, 1051],
	"leds-3.jpg": [960, 1280],
	"leds-4.png": [1280, 905],
	"matrices-1.jpg": [1280, 853],
	"matrices-2.png": [828, 509],
	"matrices-3.jpg": [1280, 1280],
	"neopixels-1.jpg": [1280, 1280],
	"neopixels-2.jpg": [1280, 832],
	"neopixels-3.jpg": [600, 600],
	"neopixels-4.jpg": [1280, 854],
	"oled-1.jpg": [1280, 923],
	"oled-2.jpg": [794, 516],
	"oled-3.jpg": [1280, 548],
	"oled-4.jpg": [1280, 854],
	"segments-1.jpg": [1280, 1280],
	"segments-2.jpg": [1280, 960],
	"segments-3.jpg": [700, 486],
	"segments-4.jpg": [1280, 765],
	"tft-1.jpg": [1280, 960],
	"tft-2.jpg": [1280, 853],
	"tft-3.jpg": [1280, 850],
	"tft-4.jpg": [1073, 356],
})
