import { isZip, openZip, type Archive } from '../../core/archive'
import { resolvePath } from '../../core/source'

export type Run =
  | { text: string; bold: boolean; italic: boolean; underline: boolean; strike: boolean; href: string | null }
  | { image: string; width: number | null }

export type Block =
  | { type: 'paragraph'; heading: number; list: { level: number; ordered: boolean } | null; runs: Run[] }
  | { type: 'table'; rows: { span: number; blocks: Block[] }[][] }

export interface OfficeSection {
  title: string | null
  blocks: Block[]
}

export interface OfficeDocument {
  sections: OfficeSection[]
  images: Map<string, Uint8Array>
  thumbnail: Uint8Array | null
  truncated: boolean
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const V = 'urn:schemas-microsoft-com:vml'
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const SAFE_LINK = /^(https?:|mailto:)/i
const BLOCK_LIMIT = 5000
const IMAGE_LIMIT = 400
const IMAGE_BYTES = 150 * 1024 * 1024
const EMU_PER_PX = 9525

export async function readOffice(buffer: ArrayBuffer, name: string): Promise<OfficeDocument> {
  if (!isZip(new Uint8Array(buffer)))
    throw new Error(
      name.startsWith('~$')
        ? 'This is a lock file Office leaves behind while a document is open. It has no content.'
        : 'This file is not a readable Office document.',
    )
  const zip = openZip(buffer)
  const part = new Part(zip)
  if (part.has('word/document.xml')) return readDocx(part)
  if (part.has('ppt/presentation.xml')) return readPptx(part)
  throw new Error('This file is not a Word or PowerPoint document.')
}

class Part {
  #names: Map<string, Archive['entries'][number]>
  images = new Map<string, Uint8Array>()
  #imageBytes = 0
  blocks = 0

  constructor(private readonly zip: Archive) {
    this.#names = new Map(zip.entries.map((e) => [e.name.replace(/^\/+/, ''), e]))
  }

  has(name: string) {
    return this.#names.has(name)
  }

  async bytes(name: string) {
    const entry = this.#names.get(name)
    return entry ? this.zip.read(entry) : null
  }

  async xml(name: string) {
    const bytes = await this.bytes(name)
    if (!bytes) return null
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml')
    return doc.getElementsByTagName('parsererror').length ? null : doc
  }

  async relationships(of: string) {
    const slash = of.lastIndexOf('/')
    const dir = of.slice(0, slash)
    const doc = await this.xml(`${dir}/_rels/${of.slice(slash + 1)}.rels`)
    const map = new Map<string, { target: string; external: boolean }>()
    for (const r of Array.from(doc?.getElementsByTagName('Relationship') ?? [])) {
      const external = r.getAttribute('TargetMode') === 'External'
      const target = r.getAttribute('Target') ?? ''
      map.set(r.getAttribute('Id') ?? '', {
        external,
        target: external ? target : target.startsWith('/') ? target.slice(1) : resolvePath(dir, target),
      })
    }
    return map
  }

  async loadImages() {
    for (const name of [...this.images.keys()]) {
      const entry = this.#names.get(name)
      if (!entry || this.images.size > IMAGE_LIMIT || this.#imageBytes + entry.size > IMAGE_BYTES) {
        this.images.delete(name)
        continue
      }
      this.#imageBytes += entry.size
      this.images.set(name, await this.zip.read(entry))
    }
  }

  room() {
    return this.blocks < BLOCK_LIMIT
  }
}

function elements(node: Node | null | undefined) {
  return node ? (Array.from(node.childNodes).filter((n) => n.nodeType === 1) as Element[]) : []
}

function child(node: Element | null | undefined, name: string, ns = W) {
  return elements(node).find((e) => e.localName === name && e.namespaceURI === ns) ?? null
}

function children(node: Element | null | undefined, name: string, ns = W) {
  return elements(node).filter((e) => e.localName === name && e.namespaceURI === ns)
}

function attr(node: Element | null | undefined, name: string, ns = W) {
  return node?.getAttributeNS(ns, name) ?? null
}

function on(node: Element | null) {
  if (!node) return false
  const value = attr(node, 'val')
  return value === null || !['0', 'false', 'none', 'off'].includes(value)
}

function emuToPx(value: string | null | undefined) {
  const emu = Number(value)
  return emu > 0 ? Math.round(emu / EMU_PER_PX) : null
}

function alternate(node: Element) {
  const options = elements(node)
  return options.find((e) => e.localName === 'Choice') ?? options.find((e) => e.localName === 'Fallback') ?? null
}

async function readDocx(part: Part): Promise<OfficeDocument> {
  const [doc, styles, numbering, rels] = await Promise.all([
    part.xml('word/document.xml'),
    part.xml('word/styles.xml'),
    part.xml('word/numbering.xml'),
    part.relationships('word/document.xml'),
  ])
  if (!doc) throw new Error('This document has no readable body.')

  const styleInfo = new Map<string, { name: string; basedOn: string | null; outline: number | null }>()
  for (const s of Array.from(styles?.getElementsByTagNameNS(W, 'style') ?? [])) {
    const outline = attr(child(child(s, 'pPr'), 'outlineLvl'), 'val')
    styleInfo.set(attr(s, 'styleId') ?? '', {
      name: (attr(child(s, 'name'), 'val') ?? '').toLowerCase(),
      basedOn: attr(child(s, 'basedOn'), 'val'),
      outline: outline === null ? null : Number(outline),
    })
  }
  const headingLevel = (styleId: string | null) => {
    for (let id = styleId, guard = 0; id && guard < 10; guard++) {
      const style = styleInfo.get(id)
      const name = style?.name ?? id.toLowerCase()
      if (name === 'title') return 1
      const match = /^heading\s*(\d)$/.exec(name)
      if (match) return Math.min(6, Number(match[1]))
      if (style?.outline != null && style.outline < 6) return style.outline + 1
      id = style?.basedOn ?? null
    }
    return 0
  }

  const formats = new Map<string, Map<string, string>>()
  if (numbering) {
    const abstract = new Map<string, Map<string, string>>()
    for (const a of Array.from(numbering.getElementsByTagNameNS(W, 'abstractNum'))) {
      const levels = new Map<string, string>()
      for (const level of children(a, 'lvl'))
        levels.set(attr(level, 'ilvl') ?? '0', attr(child(level, 'numFmt'), 'val') ?? 'bullet')
      abstract.set(attr(a, 'abstractNumId') ?? '', levels)
    }
    for (const n of Array.from(numbering.getElementsByTagNameNS(W, 'num')))
      formats.set(attr(n, 'numId') ?? '', abstract.get(attr(child(n, 'abstractNumId'), 'val') ?? '') ?? new Map())
  }

  const image = (id: string | null, width: number | null): Run[] => {
    const rel = id ? rels.get(id) : undefined
    if (!rel || rel.external) return []
    part.images.set(rel.target, new Uint8Array(0))
    return [{ image: rel.target, width }]
  }

  const drawingImages = (node: Element) => {
    const width = emuToPx(node.getElementsByTagNameNS(WP, 'extent')[0]?.getAttribute('cx'))
    const seen = new Set<string>()
    const runs: Run[] = []
    for (const blip of Array.from(node.getElementsByTagNameNS(A, 'blip'))) {
      const id = attr(blip, 'embed', R) || attr(blip, 'link', R)
      if (id && !seen.has(id)) runs.push(...image(id, width))
      if (id) seen.add(id)
    }
    for (const data of Array.from(node.getElementsByTagNameNS(V, 'imagedata')))
      runs.push(...image(attr(data, 'id', R), null))
    return runs
  }

  const runsOf = (paragraph: Element) => {
    const runs: Run[] = []
    const walk = (node: Element, href: string | null) => {
      for (const el of elements(node)) {
        if (el.localName === 'AlternateContent') {
          const pick = alternate(el)
          if (pick) walk(pick, href)
          continue
        }
        if (el.namespaceURI !== W) continue
        if (el.localName === 'hyperlink') {
          const rel = rels.get(attr(el, 'id', R) ?? '')
          walk(el, rel?.external && SAFE_LINK.test(rel.target) ? rel.target : href)
        } else if (el.localName === 'r') {
          const props = child(el, 'rPr')
          const underline = child(props, 'u')
          const style = {
            bold: on(child(props, 'b')),
            italic: on(child(props, 'i')),
            underline: !!underline && attr(underline, 'val') !== 'none',
            strike: on(child(props, 'strike')),
            href,
          }
          for (const c of elements(el)) {
            if (c.localName === 't' && c.namespaceURI === W) runs.push({ ...style, text: c.textContent ?? '' })
            else if (c.localName === 'tab') runs.push({ ...style, text: '\t' })
            else if (c.localName === 'br' || c.localName === 'cr') runs.push({ ...style, text: '\n' })
            else if (c.localName === 'noBreakHyphen') runs.push({ ...style, text: '-' })
            else if (c.localName === 'drawing' || c.localName === 'pict') runs.push(...drawingImages(c))
            else if (c.localName === 'AlternateContent') {
              const pick = alternate(c)
              if (pick) runs.push(...drawingImages(pick))
            }
          }
        } else if (['ins', 'smartTag', 'sdt', 'sdtContent', 'fldSimple', 'customXml'].includes(el.localName)) {
          walk(el, href)
        }
      }
    }
    walk(paragraph, null)
    return runs
  }

  const body = (node: Element | null, into: Block[]) => {
    for (const el of elements(node)) {
      if (!part.room()) return
      if (el.namespaceURI !== W) continue
      if (el.localName === 'p') {
        const props = child(el, 'pPr')
        const numbered = child(props, 'numPr')
        const numId = attr(child(numbered, 'numId'), 'val')
        const level = attr(child(numbered, 'ilvl'), 'val') ?? '0'
        part.blocks++
        into.push({
          type: 'paragraph',
          heading: headingLevel(attr(child(props, 'pStyle'), 'val')),
          list:
            numId && numId !== '0'
              ? {
                  level: Math.min(8, Number(level) || 0),
                  ordered: (formats.get(numId)?.get(level) ?? 'bullet') !== 'bullet',
                }
              : null,
          runs: runsOf(el),
        })
      } else if (el.localName === 'tbl') {
        part.blocks++
        into.push({
          type: 'table',
          rows: children(el, 'tr').flatMap((tr) =>
            part.room()
              ? [
                  children(tr, 'tc').map((tc) => {
                    const blocks: Block[] = []
                    body(tc, blocks)
                    return {
                      span: Math.min(64, Number(attr(child(child(tc, 'tcPr'), 'gridSpan'), 'val') ?? 1) || 1),
                      blocks,
                    }
                  }),
                ]
              : [],
          ),
        })
      } else if (el.localName === 'sdt') body(child(el, 'sdtContent'), into)
    }
  }

  const blocks: Block[] = []
  body(child(doc.documentElement, 'body'), blocks)
  await part.loadImages()
  return {
    sections: [{ title: null, blocks }],
    images: part.images,
    thumbnail: null,
    truncated: !part.room(),
  }
}

async function readPptx(part: Part): Promise<OfficeDocument> {
  const [presentation, rels] = await Promise.all([
    part.xml('ppt/presentation.xml'),
    part.relationships('ppt/presentation.xml'),
  ])
  const ordered = Array.from(presentation?.getElementsByTagNameNS(P, 'sldId') ?? [])
    .map((s) => rels.get(attr(s, 'id', R) ?? '')?.target)
    .filter((t): t is string => !!t && part.has(t))
  const slides = ordered.length
    ? ordered
    : Array.from({ length: 500 }, (_, i) => `ppt/slides/slide${i + 1}.xml`).filter((name) => part.has(name))

  const sections: OfficeSection[] = []
  for (const [index, name] of slides.entries()) {
    if (!part.room()) break
    const [doc, slideRels] = await Promise.all([part.xml(name), part.relationships(name)])
    const blocks: Block[] = []
    const paragraphs = (body: Element | null, heading: number, into: Block[]) => {
      for (const p of children(body, 'p', A)) {
        if (!part.room()) return
        const runs: Run[] = []
        for (const r of elements(p)) {
          if ((r.localName === 'r' || r.localName === 'fld') && r.namespaceURI === A) {
            const props = child(r, 'rPr', A)
            const link = slideRels.get(attr(child(props, 'hlinkClick', A), 'id', R) ?? '')
            runs.push({
              text: child(r, 't', A)?.textContent ?? '',
              bold: props?.getAttribute('b') === '1',
              italic: props?.getAttribute('i') === '1',
              underline: !!props?.getAttribute('u') && props.getAttribute('u') !== 'none',
              strike: (props?.getAttribute('strike') ?? 'noStrike') !== 'noStrike',
              href: link?.external && SAFE_LINK.test(link.target) ? link.target : null,
            })
          } else if (r.localName === 'br' && r.namespaceURI === A) {
            runs.push({ text: '\n', bold: false, italic: false, underline: false, strike: false, href: null })
          }
        }
        const level = Number(child(p, 'pPr', A)?.getAttribute('lvl') ?? 0) || 0
        part.blocks++
        into.push({ type: 'paragraph', heading, list: heading || level === 0 ? null : { level, ordered: false }, runs })
      }
    }
    const shapes = (tree: Element | null) => {
      for (const el of elements(tree)) {
        if (!part.room()) return
        if (el.localName === 'AlternateContent') {
          const pick = alternate(el)
          if (pick) shapes(pick)
        } else if (el.namespaceURI !== P) continue
        else if (el.localName === 'sp') {
          const placeholder = child(child(child(el, 'nvSpPr', P), 'nvPr', P), 'ph', P)?.getAttribute('type')
          paragraphs(child(el, 'txBody', P), placeholder === 'title' || placeholder === 'ctrTitle' ? 2 : 0, blocks)
        } else if (el.localName === 'pic') {
          const blip = child(child(el, 'blipFill', P), 'blip', A)
          const rel = slideRels.get(attr(blip, 'embed', R) ?? '')
          if (rel && !rel.external) {
            part.images.set(rel.target, new Uint8Array(0))
            part.blocks++
            blocks.push({
              type: 'paragraph',
              heading: 0,
              list: null,
              runs: [
                {
                  image: rel.target,
                  width: emuToPx(child(child(child(el, 'spPr', P), 'xfrm', A), 'ext', A)?.getAttribute('cx')),
                },
              ],
            })
          }
        } else if (el.localName === 'graphicFrame') {
          const table = el.getElementsByTagNameNS(A, 'tbl')[0]
          if (!table) continue
          part.blocks++
          blocks.push({
            type: 'table',
            rows: children(table, 'tr', A).map((tr) =>
              children(tr, 'tc', A).map((tc) => {
                const cell: Block[] = []
                paragraphs(child(tc, 'txBody', A), 0, cell)
                return { span: Math.min(64, Number(tc.getAttribute('gridSpan') ?? 1) || 1), blocks: cell }
              }),
            ),
          })
        } else if (el.localName === 'grpSp') shapes(el)
      }
    }
    shapes(child(child(doc?.documentElement, 'cSld', P), 'spTree', P))
    sections.push({ title: `Slide ${index + 1}`, blocks })
  }

  await part.loadImages()
  return {
    sections,
    images: part.images,
    thumbnail: await part.bytes('docProps/thumbnail.jpeg'),
    truncated: !part.room() || sections.length < slides.length,
  }
}
