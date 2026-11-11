import { isCfb, openCfb, type Cfb } from '../../core/cfb'
import { pathPoints, type EasyEdaVisualBounds, type EasyEdaVisualPrimitive } from '../easyeda/visual'

export type Props = Map<string, string>
export type Primitive = EasyEdaVisualPrimitive
export interface Point {
  x: number
  y: number
}

const MAX_RECORDS = 500_000
const LATIN1 = new TextDecoder('latin1')
const ANSI = new TextDecoder('windows-1252')
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true })

function decodeValue(bytes: Uint8Array) {
  if (bytes.every((b) => b < 0x80)) return LATIN1.decode(bytes)
  try {
    return STRICT_UTF8.decode(bytes)
  } catch {
    return ANSI.decode(bytes)
  }
}

export function parseProps(bytes: Uint8Array): Props {
  const props: Props = new Map()
  let start = 0
  for (let i = 0; i <= bytes.length; i++) {
    if (i < bytes.length && bytes[i] !== 0x7c) continue
    const part = bytes.subarray(start, i)
    start = i + 1
    const eq = part.indexOf(0x3d)
    if (eq <= 0) continue
    let key = LATIN1.decode(part.subarray(0, eq)).toUpperCase()
    let end = part.length
    while (end > eq + 1 && part[end - 1] === 0) end--
    const value = decodeValue(part.subarray(eq + 1, end))
    if (key.startsWith('%UTF8%')) key = key.slice(6)
    else if (props.has(key) && key !== 'RECORD') continue
    props.set(key, value)
  }
  return props
}

export function readLengthPrefixed(bytes: Uint8Array | null, onBinary?: (kind: number, payload: Uint8Array) => void) {
  const out: Props[] = []
  if (!bytes) return out
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let o = 0; o + 4 <= bytes.length && out.length < MAX_RECORDS; ) {
    const header = view.getUint32(o, true)
    const length = header & 0xffffff
    const kind = header >>> 24
    const payload = bytes.subarray(o + 4, Math.min(bytes.length, o + 4 + length))
    if (kind === 0) out.push(parseProps(payload))
    else onBinary?.(kind, payload)
    o += 4 + length
  }
  return out
}

function readAsciiLines(bytes: Uint8Array) {
  const out: Props[] = []
  let start = 0
  for (let i = 0; i <= bytes.length && out.length < MAX_RECORDS; i++) {
    if (i < bytes.length && bytes[i] !== 0x0a) continue
    let end = i
    if (end > start && bytes[end - 1] === 0x0d) end--
    if (end > start) out.push(parseProps(bytes.subarray(start, end)))
    start = i + 1
  }
  return out
}

function isAsciiAltium(bytes: Uint8Array) {
  const head = LATIN1.decode(bytes.subarray(0, 64)).replace(/^﻿|^ï»¿/, '')
  return head.startsWith('|HEADER=') || head.startsWith('|RECORD=')
}

export type AltiumContainer = { kind: 'cfb'; file: Cfb } | { kind: 'ascii'; records: Props[] }

export function openAltium(bytes: Uint8Array): AltiumContainer {
  if (isCfb(bytes)) return { kind: 'cfb', file: openCfb(bytes) }
  if (isAsciiAltium(bytes)) return { kind: 'ascii', records: readAsciiLines(bytes) }
  throw new Error('This is not an Altium file the viewer can read.')
}

export function num(props: Props, key: string, fallback = 0) {
  const raw = props.get(key)
  if (raw == null || raw === '') return fallback
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
}

export function coord(props: Props, key: string) {
  return num(props, key) + num(props, `${key}_FRAC`) / 100000
}

export function bool(props: Props, key: string) {
  const v = props.get(key)?.toUpperCase()
  return v === 'T' || v === 'TRUE'
}

export function pcbLength(props: Props, key: string, fallback = 0) {
  const raw = props.get(key)
  if (raw == null || raw === '') return fallback
  const n = parseFloat(raw)
  if (!Number.isFinite(n)) return fallback
  if (/mm$/i.test(raw)) return n / 0.0254
  if (/mil$/i.test(raw)) return n
  return n / 10000
}

export function boundsOf(primitives: Primitive[], extra: Point[] = []): EasyEdaVisualBounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const add = (x: number, y: number, pad = 0) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    minX = Math.min(minX, x - pad)
    minY = Math.min(minY, y - pad)
    maxX = Math.max(maxX, x + pad)
    maxY = Math.max(maxY, y + pad)
  }
  for (const p of primitives) {
    if (p.kind === 'polyline') for (const pt of p.points) add(pt.x, pt.y, p.strokeWidth / 2)
    else if (p.kind === 'path') for (const pt of p.points ?? pathPoints(p.path)) add(pt.x, pt.y, p.strokeWidth / 2)
    else if (p.kind === 'circle') add(p.cx, p.cy, p.r)
    else if (p.kind === 'rect') {
      add(p.x, p.y)
      add(p.x + p.width, p.y + p.height)
    } else if (p.kind === 'text') add(p.x, p.y, p.size / 2)
  }
  for (const pt of extra) add(pt.x, pt.y)
  if (!Number.isFinite(minX)) return null
  return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}
