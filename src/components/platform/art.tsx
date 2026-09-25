/**
 * Every illustration in Half Life is authored here: one fox, five week
 * scenes, the grand prize, and the shop objects. Common rules — navy ink at
 * a 4–5 unit stroke, flat brand fills, no gradients except where a screen or
 * a light is actually emitting.
 */

import Image, { type StaticImageData } from "next/image"
import breadboardPainting from "../../../public/art/weeks/breadboard.png"
import cadPainting from "../../../public/art/weeks/cad.png"
import displayPainting from "../../../public/art/weeks/display.png"
import musicPainting from "../../../public/art/weeks/music.png"
import pcbPainting from "../../../public/art/weeks/PCB.png"

const INK = "#1c1a59"

/* ------------------------------------------------------------------ *
 * Filters. Mounted once, referenced by .sketch / .torn in globals.css
 * ------------------------------------------------------------------ */
export function SketchDefs() {
  return (
    <svg aria-hidden="true" focusable="false" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        <filter id="hl-wobble" x="-12%" y="-12%" width="124%" height="124%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="4.2" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="hl-wobble-2" x="-12%" y="-12%" width="124%" height="124%">
          <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="21" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="hl-wobble-3" x="-14%" y="-14%" width="128%" height="128%">
          <feTurbulence type="fractalNoise" baseFrequency="0.034" numOctaves="2" seed="43" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="3.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="hl-tear" x="-10%" y="-25%" width="120%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02 0.11" numOctaves="3" seed="11" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="hl-tear-soft" x="-10%" y="-20%" width="120%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.03 0.09" numOctaves="2" seed="31" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * The fox
 * ------------------------------------------------------------------ */

const FOX_PATH =
  "M60 15 L30 2 L34 44 L12 39 L25 62 L5 72 L27 80 L34 97 L49 86 L52 105 L72 105 L75 86 L90 97 L97 80 L119 72 L99 62 L112 39 L90 44 L94 2 Z"

export function FoxMark({
  className,
  sticker = true,
  face = "#fdfbfa",
}: {
  className?: string
  sticker?: boolean
  face?: string
}) {
  return (
    <svg viewBox="-6 -6 136 122" className={className} role="img" aria-label="Half Life fox">
      {sticker && <path d={FOX_PATH} fill="none" stroke="#e5e0dc" strokeWidth={22} strokeLinejoin="round" />}
      <path d={FOX_PATH} fill={face} stroke={INK} strokeWidth={5.5} strokeLinejoin="round" />
      {/* X eye */}
      <path d="M36 52 L52 68 M52 52 L36 68" stroke={INK} strokeWidth={6} strokeLinecap="round" />
      {/* winking slash */}
      <path d="M74 64 L92 50" stroke={INK} strokeWidth={7} strokeLinecap="round" />
      {/* nose */}
      <path d="M56 78 h11 v13 a5.5 5.5 0 0 1 -11 0 Z" fill={INK} />
    </svg>
  )
}

const AVATAR_BG: Record<string, string> = {
  "fox-blueprint": "#06ae97",
  "fox-goggles": "#52b4d5",
  "fox-solder": "#b21b9b",
  "fox-plain": "#fba62f",
  "fox-cap": "#a47cc0",
}

export function FoxAvatar({ variant, className }: { variant: string; className?: string }) {
  const bg = AVATAR_BG[variant] ?? "#52b4d5"
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label="Avatar">
      <rect width="120" height="120" rx="10" fill={bg} />
      <g transform="translate(12 34) scale(0.8)">
        <path d={FOX_PATH} fill="#fdfbfa" stroke={INK} strokeWidth={5.5} strokeLinejoin="round" />
        <path d="M36 52 L52 68 M52 52 L36 68" stroke={INK} strokeWidth={6} strokeLinecap="round" />
        <path d="M74 64 L92 50" stroke={INK} strokeWidth={7} strokeLinecap="round" />
        <path d="M56 78 h11 v13 a5.5 5.5 0 0 1 -11 0 Z" fill={INK} />
      </g>
      {variant === "fox-blueprint" && (
        <g>
          <rect x="22" y="76" width="76" height="40" rx="4" fill="#2b5fd9" stroke={INK} strokeWidth={4} />
          <path d="M32 88h26M32 96h18M32 104h30M70 86v24" stroke="#cfe3ff" strokeWidth={3} strokeLinecap="round" />
        </g>
      )}
      {variant === "fox-goggles" && (
        <g>
          <rect x="20" y="52" width="80" height="22" rx="11" fill="#1c1a59" opacity="0.18" />
          <circle cx="42" cy="63" r="14" fill="#cfeaf4" stroke={INK} strokeWidth={4} />
          <circle cx="78" cy="63" r="14" fill="#cfeaf4" stroke={INK} strokeWidth={4} />
          <path d="M56 63h8" stroke={INK} strokeWidth={4} />
        </g>
      )}
      {variant === "fox-solder" && (
        <g>
          <path d="M84 104 L112 76" stroke={INK} strokeWidth={7} strokeLinecap="round" />
          <path d="M80 108 L90 98" stroke="#f35757" strokeWidth={8} strokeLinecap="round" />
          <circle cx="76" cy="112" r="4" fill="#fba62f" />
        </g>
      )}
      {variant === "fox-cap" && (
        <g>
          <path d="M26 42 q34 -26 68 0 Z" fill="#f35757" stroke={INK} strokeWidth={4} strokeLinejoin="round" />
          <path d="M94 42 q18 2 20 10 l-26 -2 Z" fill="#f35757" stroke={INK} strokeWidth={4} strokeLinejoin="round" />
        </g>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * Week scenes
 * ------------------------------------------------------------------ */

function ScenePCB() {
  return (
    <g>
      <rect x="18" y="26" width="164" height="108" rx="10" fill="#0f7a5c" stroke={INK} strokeWidth={4} />
      <path
        d="M36 52h30v26h34M36 96h22v22h58M118 44v28h38M150 96h18"
        stroke="#ffd45e"
        strokeWidth={3.4}
        fill="none"
        strokeLinecap="round"
      />
      <rect x="82" y="44" width="34" height="26" rx="3" fill="#1c1a59" />
      <path d="M86 48h4M86 54h4M86 60h4M108 48h4M108 54h4M108 60h4" stroke="#8fa3d8" strokeWidth={2} />
      <g fill="#f4f1ee" stroke={INK} strokeWidth={3}>
        <rect x="112" y="88" width="24" height="24" rx="3" />
        <rect x="140" y="88" width="24" height="24" rx="3" />
        <rect x="126" y="60" width="24" height="24" rx="3" opacity="0.95" />
      </g>
      <circle cx="36" cy="40" r="5" fill="#f35757" stroke={INK} strokeWidth={2.6} />
      <circle cx="164" cy="40" r="5" fill="#f35757" stroke={INK} strokeWidth={2.6} />
      <circle cx="36" cy="120" r="5" fill="#f35757" stroke={INK} strokeWidth={2.6} />
      <rect x="48" y="102" width="30" height="16" rx="2" fill="#262a2d" stroke={INK} strokeWidth={2.6} />
    </g>
  )
}

function SceneCAD() {
  return (
    <g>
      <path
        d="M52 108 L52 56 L100 32 L148 56 L148 108 L100 132 Z"
        fill="#aef2dd"
        stroke={INK}
        strokeWidth={4}
        strokeLinejoin="round"
      />
      <path d="M52 56 L100 80 L148 56 M100 80 v52" stroke={INK} strokeWidth={3.4} fill="none" />
      <circle cx="100" cy="80" r="14" fill="#fcf7f7" stroke={INK} strokeWidth={3.4} />
      <path d="M36 56 v52 M30 56 h12 M30 108 h12" stroke="#b21b9b" strokeWidth={2.6} strokeLinecap="round" />
      <path d="M52 24 h96 M52 18 v12 M148 18 v12" stroke="#b21b9b" strokeWidth={2.6} strokeLinecap="round" />
      <path d="M160 44 l16 -12 M176 32 l-2 8 M176 32 l-8 2" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
    </g>
  )
}

function SceneSynth() {
  return (
    <g>
      <rect x="22" y="38" width="156" height="84" rx="8" fill="#2a2140" stroke={INK} strokeWidth={4} />
      <g stroke={INK} strokeWidth={3}>
        <circle cx="52" cy="66" r="15" fill="#fba62f" />
        <circle cx="94" cy="66" r="15" fill="#aef2dd" />
        <circle cx="136" cy="66" r="15" fill="#f35757" />
      </g>
      <path d="M52 66 l0 -11 M94 66 l8 -8 M136 66 l-9 -7" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <rect x="38" y="94" width="124" height="16" rx="4" fill="#0e0a1c" stroke={INK} strokeWidth={2.6} />
      <path d="M44 102 q8 -8 16 0 t16 0 t16 0 t16 0 t16 0 t16 0" stroke="#75d0c9" strokeWidth={2.6} fill="none" />
      <path d="M34 44 q-16 -26 22 -22" stroke="#f35757" strokeWidth={4.5} fill="none" strokeLinecap="round" />
      <path d="M166 44 q16 -30 -26 -24" stroke="#52b4d5" strokeWidth={4.5} fill="none" strokeLinecap="round" />
    </g>
  )
}

function SceneDisplay() {
  const on = new Set([9, 10, 13, 14, 18, 21, 25, 26, 27, 28])
  return (
    <g>
      <rect x="34" y="30" width="132" height="100" rx="8" fill="#141b2e" stroke={INK} strokeWidth={4} />
      <g>
        {Array.from({ length: 36 }, (_, i) => {
          const c = i % 6
          const r = Math.floor(i / 6)
          return (
            <rect
              key={i}
              x={48 + c * 18}
              y={44 + r * 14}
              width={12}
              height={9}
              rx={2}
              fill={on.has(i) ? "#fba62f" : "#26314f"}
            />
          )
        })}
      </g>
      <rect x="86" y="130" width="28" height="12" rx="3" fill="#262a2d" stroke={INK} strokeWidth={3} />
      <path d="M22 62 l-12 -8 M22 80 l-14 2" stroke="#fba62f" strokeWidth={3} strokeLinecap="round" />
      <path d="M178 62 l12 -8 M178 80 l14 2" stroke="#fba62f" strokeWidth={3} strokeLinecap="round" />
    </g>
  )
}

function SceneBread() {
  return (
    <g>
      <rect x="16" y="34" width="168" height="94" rx="6" fill="#f4f1ee" stroke={INK} strokeWidth={4} />
      <path d="M16 76 h168 M16 86 h168" stroke="#ded8d2" strokeWidth={3} />
      <g fill="#8e8a9e">
        {Array.from({ length: 30 }, (_, i) => (
          <circle key={`a${i}`} cx={26 + (i % 15) * 11} cy={i < 15 ? 50 : 62} r={1.8} />
        ))}
        {Array.from({ length: 30 }, (_, i) => (
          <circle key={`b${i}`} cx={26 + (i % 15) * 11} cy={i < 15 ? 100 : 112} r={1.8} />
        ))}
      </g>
      <rect x="52" y="70" width="46" height="22" rx="2" fill="#262a2d" stroke={INK} strokeWidth={2.6} />
      <rect x="112" y="70" width="34" height="22" rx="2" fill="#262a2d" stroke={INK} strokeWidth={2.6} />
      <path d="M40 56 q14 -22 36 -4" stroke="#f35757" strokeWidth={3.4} fill="none" strokeLinecap="round" />
      <path d="M92 56 q20 -26 48 -2" stroke="#06ae97" strokeWidth={3.4} fill="none" strokeLinecap="round" />
      <path d="M62 106 q24 20 62 2" stroke="#fba62f" strokeWidth={3.4} fill="none" strokeLinecap="round" />
      <circle cx="160" cy="54" r="6" fill="#f35757" stroke={INK} strokeWidth={2.6} />
      <circle cx="160" cy="110" r="6" fill="#aef2dd" stroke={INK} strokeWidth={2.6} />
    </g>
  )
}

export function WeekScene({ theme, className }: { theme: string; className?: string }) {
  const scene =
    theme === "CAD" ? (
      <SceneCAD />
    ) : theme === "Music" ? (
      <SceneSynth />
    ) : theme === "Displays" ? (
      <SceneDisplay />
    ) : theme === "Breadboard computer" ? (
      <SceneBread />
    ) : (
      <ScenePCB />
    )
  return (
    <svg viewBox="0 0 200 160" className={className} role="img" aria-label={`${theme} illustration`}>
      {scene}
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * Week paintings
 * ------------------------------------------------------------------ */

/**
 * The programme's own painted stickers, one per theme, from `public/art/weeks`
 * — the same files the landing page's "how does it work?" plate shows. A
 * theme with no painting falls back to its drawn scene.
 *
 * Imported rather than named by path, as the landing's are: the URL carries
 * a hash of the file, so a repainted sticker is never served from a stale
 * cache. Each source is a 3000px square of 2–4 MB, which is why this goes
 * through `next/image` and names the size it is shown at.
 */
const WEEK_PAINTINGS: Partial<Record<string, StaticImageData>> = {
  PCB: pcbPainting,
  CAD: cadPainting,
  Music: musicPainting,
  Displays: displayPainting,
  "Breadboard computer": breadboardPainting,
}

export function WeekPainting({
  theme,
  className,
  sizes,
}: {
  theme: string
  className?: string
  /** The rendered width, for `next/image`. */
  sizes: string
}) {
  const painting = WEEK_PAINTINGS[theme]
  if (!painting) return <WeekScene theme={theme} className={className} />
  return (
    <span className={`relative block ${className ?? ""}`}>
      <Image src={painting} alt={`${theme} illustration`} fill sizes={sizes} className="object-contain" />
    </span>
  )
}

/* ------------------------------------------------------------------ *
 * The grand prize
 * ------------------------------------------------------------------ */
const PRINTER_BODY: Record<string, React.ReactNode> = {
  /* Open-frame bed-slinger — Ender 3, A1, A1 Mini, Neptune 4 */
  bedslinger: (
    <g>
      <rect x="22" y="182" width="176" height="26" rx="5" fill="#3a3f4a" stroke={INK} strokeWidth={4} />
      <rect x="34" y="208" width="152" height="10" rx="4" fill="#262a2d" stroke={INK} strokeWidth={3.4} />
      <rect x="44" y="166" width="132" height="18" rx="3" fill="#52b4d5" stroke={INK} strokeWidth={4} />
      <rect x="46" y="34" width="18" height="150" rx="4" fill="#9aa3b2" stroke={INK} strokeWidth={4} />
      <rect x="156" y="34" width="18" height="150" rx="4" fill="#9aa3b2" stroke={INK} strokeWidth={4} />
      <rect x="40" y="24" width="140" height="16" rx="4" fill="#767f8d" stroke={INK} strokeWidth={4} />
      <rect x="40" y="92" width="140" height="14" rx="4" fill="#767f8d" stroke={INK} strokeWidth={4} />
      <rect x="92" y="84" width="40" height="32" rx="4" fill="#f35757" stroke={INK} strokeWidth={4} />
      <path d="M112 116 l-7 14 h14 Z" fill="#262a2d" stroke={INK} strokeWidth={3.4} strokeLinejoin="round" />
      <circle cx="110" cy="14" r="22" fill="#aef2dd" stroke={INK} strokeWidth={4} />
      <circle cx="110" cy="14" r="7" fill="#fcf7f7" stroke={INK} strokeWidth={3.4} />
      <path d="M110 36 q-26 22 -4 46" stroke="#06ae97" strokeWidth={3.4} fill="none" strokeLinecap="round" />
      <path d="M92 166 q0 -24 18 -24 t18 24 Z" fill="#fba62f" stroke={INK} strokeWidth={4} strokeLinejoin="round" />
      <path d="M97 154 h26" stroke={INK} strokeWidth={2.4} opacity="0.5" />
      <path d="M100 148 h20" stroke={INK} strokeWidth={2.4} opacity="0.5" />
      <rect x="140" y="188" width="44" height="16" rx="3" fill="#aef2dd" stroke={INK} strokeWidth={3.4} />
    </g>
  ),

  /* Enclosed CoreXY — Centauri 2, P1S. A box you look into. */
  corexy: (
    <g>
      <rect x="24" y="44" width="172" height="162" rx="9" fill="#3a3f4a" stroke={INK} strokeWidth={4} />
      <rect x="36" y="56" width="148" height="124" rx="6" fill="#262a2d" stroke={INK} strokeWidth={4} />
      <rect x="44" y="64" width="132" height="108" rx="4" fill="#cfeaf4" stroke={INK} strokeWidth={3} />
      {/* seen through the door */}
      <rect x="48" y="72" width="124" height="11" rx="3" fill="#767f8d" stroke={INK} strokeWidth={3.4} />
      <rect x="96" y="68" width="34" height="27" rx="4" fill="#f35757" stroke={INK} strokeWidth={3.4} />
      <path d="M113 95 l-6 12 h12 Z" fill="#262a2d" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <rect x="58" y="150" width="104" height="13" rx="3" fill="#52b4d5" stroke={INK} strokeWidth={4} />
      <path d="M96 150 q0 -22 17 -22 t17 22 Z" fill="#fba62f" stroke={INK} strokeWidth={3.4} strokeLinejoin="round" />
      <path d="M60 168 L150 70" stroke="#ffffff" strokeWidth={11} opacity="0.4" strokeLinecap="round" />
      <path d="M168 104 v32" stroke={INK} strokeWidth={5} strokeLinecap="round" />
      <rect x="132" y="186" width="48" height="14" rx="3" fill="#aef2dd" stroke={INK} strokeWidth={3.4} />
      <circle cx="52" cy="191" r="7" fill="#fba62f" stroke={INK} strokeWidth={3} />
      {/* spool riding the lid */}
      <circle cx="108" cy="24" r="20" fill="#aef2dd" stroke={INK} strokeWidth={4} />
      <circle cx="108" cy="24" r="6.5" fill="#fcf7f7" stroke={INK} strokeWidth={3.2} />
      <path d="M128 30 q14 10 6 20" stroke="#06ae97" strokeWidth={3.4} fill="none" strokeLinecap="round" />
    </g>
  ),

  /* MSLA resin — vat, lead screw, and the amber hood that keeps daylight out. */
  resin: (
    <g>
      <rect x="34" y="168" width="152" height="44" rx="6" fill="#3a3f4a" stroke={INK} strokeWidth={4} />
      <rect x="46" y="212" width="128" height="9" rx="4" fill="#262a2d" stroke={INK} strokeWidth={3.2} />
      <rect x="52" y="181" width="52" height="19" rx="3" fill="#aef2dd" stroke={INK} strokeWidth={3.4} />
      <circle cx="158" cy="191" r="10" fill="#fba62f" stroke={INK} strokeWidth={3.4} />
      <path d="M158 185 v6" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      {/* lead-screw tower */}
      <rect x="150" y="26" width="26" height="144" rx="5" fill="#767f8d" stroke={INK} strokeWidth={4} />
      <path d="M163 34 v130" stroke={INK} strokeWidth={2.6} opacity="0.4" />
      <rect x="96" y="72" width="58" height="16" rx="3" fill="#4a5058" stroke={INK} strokeWidth={4} />
      {/* build plate, with the print hanging off it */}
      <rect x="68" y="88" width="76" height="12" rx="2" fill="#e4e7eb" stroke={INK} strokeWidth={4} />
      <path
        d="M94 100 h24 l-5 18 h6 l-13 16 l-13 -16 h6 Z"
        fill="#aef2dd"
        stroke={INK}
        strokeWidth={3.4}
        strokeLinejoin="round"
      />
      {/* vat of resin, lit from below */}
      <rect x="44" y="126" width="104" height="42" rx="4" fill="#4a5058" stroke={INK} strokeWidth={4} />
      <rect x="54" y="135" width="84" height="19" rx="2" fill="#fba62f" stroke={INK} strokeWidth={3} />
      <rect x="54" y="157" width="84" height="8" rx="2" fill="#b21b9b" stroke={INK} strokeWidth={2.4} />
      {/* the amber hood, down — tinted, not opaque */}
      <rect
        x="34"
        y="16"
        width="152"
        height="154"
        rx="12"
        fill="#fba62f"
        fillOpacity="0.16"
        stroke={INK}
        strokeWidth={4}
      />
      <path d="M56 148 L118 40" stroke="#ffffff" strokeWidth={9} opacity="0.32" strokeLinecap="round" />
      <rect x="90" y="5" width="40" height="13" rx="6" fill="#fba62f" stroke={INK} strokeWidth={3.4} />
    </g>
  ),

  /* Benchtop router — gantry, spindle, and a board with a groove in it. */
  cnc: (
    <g>
      <rect x="20" y="158" width="180" height="32" rx="5" fill="#9aa3b2" stroke={INK} strokeWidth={4} />
      <path d="M20 170 h180 M20 180 h180" stroke={INK} strokeWidth={2.4} opacity="0.4" />
      <rect x="34" y="190" width="152" height="12" rx="4" fill="#262a2d" stroke={INK} strokeWidth={3.4} />
      <rect x="30" y="52" width="20" height="110" rx="4" fill="#767f8d" stroke={INK} strokeWidth={4} />
      <rect x="170" y="52" width="20" height="110" rx="4" fill="#767f8d" stroke={INK} strokeWidth={4} />
      <rect x="24" y="36" width="172" height="20" rx="4" fill="#9aa3b2" stroke={INK} strokeWidth={4} />
      <circle cx="180" cy="26" r="9" fill="#f35757" stroke={INK} strokeWidth={3.4} />
      <rect x="88" y="52" width="44" height="52" rx="6" fill="#06ae97" stroke={INK} strokeWidth={4} />
      <path d="M96 66 h28 M96 78 h28" stroke={INK} strokeWidth={2.6} opacity="0.5" />
      <rect x="101" y="104" width="18" height="13" rx="2" fill="#c8ccd2" stroke={INK} strokeWidth={3.4} />
      <path d="M110 117 v20" stroke={INK} strokeWidth={5} strokeLinecap="round" />
      {/* stock, part-cut */}
      <rect x="62" y="132" width="96" height="27" rx="3" fill="#f4dfc6" stroke={INK} strokeWidth={4} />
      <path d="M74 144 h60" stroke="#cdae8a" strokeWidth={6} strokeLinecap="round" />
      <path d="M94 128 l-7 -9 M128 128 l8 -9" stroke={INK} strokeWidth={3} strokeLinecap="round" opacity="0.55" />
    </g>
  ),
}

const PRINTER_LABEL: Record<string, string> = {
  bedslinger: "Open-frame 3D printer",
  corexy: "Enclosed CoreXY 3D printer",
  resin: "Resin 3D printer",
  cnc: "Benchtop CNC router",
}

export function PrinterArt({ kind, className }: { kind: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 220 240"
      className={className}
      role="img"
      aria-label={PRINTER_LABEL[kind] ?? PRINTER_LABEL.bedslinger}
    >
      {PRINTER_BODY[kind] ?? PRINTER_BODY.bedslinger}
    </svg>
  )
}

/** The open-frame machine, kept under its own name for scenes that always draw one. */
export function EnderPrinter({ className }: { className?: string }) {
  return <PrinterArt kind="bedslinger" className={className} />
}

/* ------------------------------------------------------------------ *
 * Shop objects
 * ------------------------------------------------------------------ */
export function ShopArt({ art, className }: { art: string; className?: string }) {
  const body: Record<string, React.ReactNode> = {
    grant: (
      <g>
        <rect x="20" y="42" width="120" height="76" rx="9" fill="#06ae97" stroke={INK} strokeWidth={4} />
        <rect x="20" y="58" width="120" height="16" fill="#1c1a59" />
        <rect x="32" y="88" width="46" height="10" rx="3" fill="#aef2dd" />
        <rect x="96" y="86" width="30" height="20" rx="4" fill="#fba62f" stroke={INK} strokeWidth={3} />
        <path d="M104 96h14M111 89v14" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      </g>
    ),
    printer: (
      <g transform="translate(18 6) scale(0.52)">
        <EnderInline />
      </g>
    ),
    iron: (
      <g>
        <path d="M28 118 L92 54" stroke="#262a2d" strokeWidth={16} strokeLinecap="round" />
        <path d="M28 118 L92 54" stroke="#4a5058" strokeWidth={9} strokeLinecap="round" />
        <path d="M92 54 L120 30 l8 8 -26 28 Z" fill="#c8ccd2" stroke={INK} strokeWidth={4} strokeLinejoin="round" />
        <path d="M120 30 l14 -12" stroke="#fba62f" strokeWidth={6} strokeLinecap="round" />
        <rect x="18" y="108" width="24" height="18" rx="5" fill="#06ae97" stroke={INK} strokeWidth={3.4} />
      </g>
    ),
    scope: (
      <g>
        <rect x="22" y="40" width="116" height="80" rx="8" fill="#3a3f4a" stroke={INK} strokeWidth={4} />
        <rect x="32" y="50" width="78" height="60" rx="4" fill="#0d1a14" stroke={INK} strokeWidth={3} />
        <path d="M36 80 q8 -22 16 0 t16 0 t16 0 t16 0" stroke="#5cf2a8" strokeWidth={3} fill="none" />
        <circle cx="124" cy="62" r="7" fill="#fba62f" stroke={INK} strokeWidth={3} />
        <circle cx="124" cy="86" r="7" fill="#f35757" stroke={INK} strokeWidth={3} />
        <rect x="118" y="102" width="14" height="8" rx="2" fill="#aef2dd" stroke={INK} strokeWidth={2.6} />
      </g>
    ),
    kit: (
      <g>
        <rect x="24" y="52" width="112" height="70" rx="6" fill="#f4dfc6" stroke={INK} strokeWidth={4} />
        <path d="M24 74 h112 M60 52 v70 M98 52 v70" stroke={INK} strokeWidth={3} />
        <circle cx="42" cy="63" r="6" fill="#f35757" stroke={INK} strokeWidth={2.6} />
        <circle cx="79" cy="63" r="6" fill="#52b4d5" stroke={INK} strokeWidth={2.6} />
        <circle cx="117" cy="63" r="6" fill="#06ae97" stroke={INK} strokeWidth={2.6} />
        <path d="M34 92 h18 M68 92 h18 M106 92 h18" stroke={INK} strokeWidth={4} strokeLinecap="round" />
        <path d="M34 106 h18 M68 106 h18 M106 106 h18" stroke={INK} strokeWidth={4} strokeLinecap="round" />
      </g>
    ),
    shirt: (
      <g>
        <path
          d="M54 38 L34 52 L46 70 L56 64 V126 h48 V64 l10 6 12 -18 -20 -14 -14 8 h-14 Z"
          fill="#1c1a59"
          stroke={INK}
          strokeWidth={4}
          strokeLinejoin="round"
        />
        <g transform="translate(62 78) scale(0.32)">
          <path d={FOX_PATH} fill="#fdfbfa" />
        </g>
      </g>
    ),
    sticker: (
      <g>
        <rect
          x="26"
          y="50"
          width="52"
          height="52"
          rx="8"
          fill="#fba62f"
          stroke={INK}
          strokeWidth={4}
          transform="rotate(-8 52 76)"
        />
        <rect
          x="62"
          y="62"
          width="52"
          height="52"
          rx="8"
          fill="#52b4d5"
          stroke={INK}
          strokeWidth={4}
          transform="rotate(6 88 88)"
        />
        <g transform="translate(70 70) scale(0.3)">
          <path d={FOX_PATH} fill="#fdfbfa" stroke={INK} strokeWidth={9} strokeLinejoin="round" />
        </g>
      </g>
    ),
    meter: (
      <g>
        <rect x="34" y="34" width="92" height="94" rx="9" fill="#fba62f" stroke={INK} strokeWidth={4} />
        <rect x="44" y="44" width="72" height="30" rx="4" fill="#1c2b22" stroke={INK} strokeWidth={3} />
        <path
          d="M52 62 h10 M68 54 v14 M76 62 h10 M94 54 v14"
          stroke="#5cf2a8"
          strokeWidth={3.4}
          strokeLinecap="round"
        />
        <circle cx="80" cy="100" r="18" fill="#fcf7f7" stroke={INK} strokeWidth={3.4} />
        <path d="M80 100 l10 -12" stroke={INK} strokeWidth={3.4} strokeLinecap="round" />
        <path d="M44 138 q18 14 36 0" stroke="#f35757" strokeWidth={4} fill="none" strokeLinecap="round" />
        <path d="M80 138 q18 14 36 0" stroke="#262a2d" strokeWidth={4} fill="none" strokeLinecap="round" />
      </g>
    ),
  }

  return (
    <svg viewBox="0 0 160 160" className={className} role="img" aria-label="">
      {body[art] ?? body.grant}
    </svg>
  )
}

function EnderInline() {
  return (
    <g>
      <rect x="22" y="182" width="176" height="26" rx="5" fill="#3a3f4a" stroke={INK} strokeWidth={6} />
      <rect x="44" y="166" width="132" height="18" rx="3" fill="#52b4d5" stroke={INK} strokeWidth={6} />
      <rect x="46" y="34" width="18" height="150" rx="4" fill="#9aa3b2" stroke={INK} strokeWidth={6} />
      <rect x="156" y="34" width="18" height="150" rx="4" fill="#9aa3b2" stroke={INK} strokeWidth={6} />
      <rect x="40" y="24" width="140" height="16" rx="4" fill="#767f8d" stroke={INK} strokeWidth={6} />
      <rect x="40" y="92" width="140" height="14" rx="4" fill="#767f8d" stroke={INK} strokeWidth={6} />
      <rect x="92" y="84" width="40" height="32" rx="4" fill="#f35757" stroke={INK} strokeWidth={6} />
      <path d="M92 166 q0 -24 18 -24 t18 24 Z" fill="#fba62f" stroke={INK} strokeWidth={6} strokeLinejoin="round" />
    </g>
  )
}

/* ------------------------------------------------------------------ *
 * Reel backdrops — a still frame stands in for video
 * ------------------------------------------------------------------ */
export function ReelScene({ scene, className }: { scene: string; className?: string }) {
  const map = {
    hq: {
      bg: "#1c1a59",
      inner: (
        <g transform="translate(120 205)">
          <path d={FOX_PATH} fill="#fcf7f7" stroke="#fcf7f7" strokeWidth={4} strokeLinejoin="round" />
        </g>
      ),
    },
    pcb: {
      bg: "#0f5f4c",
      inner: (
        <g transform="translate(40 130) scale(1.4)">
          <ScenePCB />
        </g>
      ),
    },
    cad: {
      bg: "#0d5f78",
      inner: (
        <g transform="translate(40 130) scale(1.4)">
          <SceneCAD />
        </g>
      ),
    },
    synth: {
      bg: "#3c1050",
      inner: (
        <g transform="translate(40 130) scale(1.4)">
          <SceneSynth />
        </g>
      ),
    },
    display: {
      bg: "#7a4a07",
      inner: (
        <g transform="translate(40 130) scale(1.4)">
          <SceneDisplay />
        </g>
      ),
    },
    bread: {
      bg: "#4a3d6b",
      inner: (
        <g transform="translate(40 130) scale(1.4)">
          <SceneBread />
        </g>
      ),
    },
  } satisfies Record<string, { bg: string; inner: React.ReactNode }>
  const s = map[scene as keyof typeof map] ?? map.pcb
  return (
    <svg viewBox="0 0 360 560" className={className} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="360" height="560" fill={s.bg} />
      <g opacity="0.16" stroke="#ffffff" strokeWidth={1}>
        {Array.from({ length: 14 }, (_, i) => (
          <path key={i} d={`M0 ${i * 40} H360`} />
        ))}
      </g>
      {s.inner}
      <rect width="360" height="560" fill="url(#reel-vig)" />
      <defs>
        <radialGradient id="reel-vig" cx="50%" cy="42%" r="78%">
          <stop offset="55%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.45" />
        </radialGradient>
      </defs>
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * Journal media stand-ins
 * ------------------------------------------------------------------ */
export function JournalMedia({ kind, className }: { kind: string; className?: string }) {
  const map = {
    board: { bg: "#52b4d5", art: <ScenePCB /> },
    cad: { bg: "#06ae97", art: <SceneCAD /> },
    scope: { bg: "#262a2d", art: <SceneSynth /> },
    bench: { bg: "#fba62f", art: <SceneBread /> },
  } satisfies Record<string, { bg: string; art: React.ReactNode }>
  const m = map[kind as keyof typeof map] ?? map.board
  return (
    <svg viewBox="0 0 200 160" className={className} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="200" height="160" fill={m.bg} />
      <g transform="translate(10 8) scale(0.9)">{m.art}</g>
    </svg>
  )
}
