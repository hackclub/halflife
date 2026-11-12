import type { FileSource, HurtFile } from '../../types'
import { resolvePath } from '../../core/source'

export interface StaticPage {
  html: string
  title: string
  redirect: string | null
  scripts: number
  empty: boolean
}

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i
const IMAGE_LIMIT = 5 * 1024 * 1024
const IMAGES_LIMIT = 8 * 1024 * 1024
const STYLE_LIMIT = 1024 * 1024
const POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
}
const FORBID_TAGS = [
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'form',
  'base',
  'meta',
  'link',
  'noscript',
  'input',
  'button',
  'textarea',
  'select',
  'portal',
]
const HIDDEN =
  '[hidden], template, style, title, symbol, defs, [style*="display:none" i], [style*="display: none" i], [style*="visibility:hidden" i], [style*="visibility: hidden" i]'
const VISIBLE = 'img[src], table, svg :is(path, rect, circle, ellipse, line, polyline, polygon, text, use, image)'
const URL_ATTRIBUTES = ['src', 'href', 'xlink:href', 'background', 'poster', 'data', 'action', 'formaction']

function toDataUrl(bytes: ArrayBuffer, mime: string) {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000))
  return `data:${mime};base64,${btoa(binary)}`
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function repoPath(source: FileSource, file: HurtFile, value: string) {
  const path = safeDecode(value.split(/[?#]/)[0])
  if (!path.startsWith('/')) return resolvePath(file.dir, path)
  const dirs = file.dir ? file.dir.split('/') : []
  for (let depth = dirs.length; depth > 0; depth--) {
    const candidate = resolvePath(dirs.slice(0, depth).join('/'), path)
    if (source.byPath.has(candidate)) return candidate
  }
  return resolvePath('', path)
}

function isBlank(doc: Document) {
  const body = doc.body?.cloneNode(true) as HTMLElement | undefined
  if (!body) return true
  for (const el of body.querySelectorAll(HIDDEN)) el.remove()
  return (body.textContent ?? '').trim().length < 40 && !body.querySelector(VISIBLE)
}

function cleanCss(css: string) {
  return css
    .replace(/</g, '\\3c ')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)(?!data:)[^)]*\)/gi, 'none')
}

export async function staticPage(source: FileSource, file: HurtFile, text: string): Promise<StaticPage> {
  const original = new DOMParser().parseFromString(text, 'text/html')
  const refresh = original.querySelector('meta[http-equiv="refresh" i]')?.getAttribute('content') ?? ''
  const redirect = /url\s*=\s*['"]?([^'";\s]+)/i.exec(refresh)?.[1] ?? null
  const stylesheets = [...original.querySelectorAll('link[rel~="stylesheet" i][href]')]
    .map((link) => link.getAttribute('href') ?? '')
    .filter((href) => href && !EXTERNAL.test(href) && !href.startsWith('//'))

  const { default: DOMPurify } = await import('dompurify')
  const clean = DOMPurify.sanitize(text, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS,
    FORBID_ATTR: ['srcset', 'ping', 'formaction', 'action', 'imagesrcset'],
    ALLOW_DATA_ATTR: false,
  })
  const doc = new DOMParser().parseFromString(clean, 'text/html')

  let budget = IMAGES_LIMIT
  const embedImage = async (src: string) => {
    const path = repoPath(source, file, src)
    const target = source.byPath.get(path)
    const mime = MIME[target?.ext ?? '']
    if (!target || !mime || target.size > IMAGE_LIMIT || target.size > budget) return null
    budget -= target.size
    const bytes = await source.read(path).catch(() => null)
    return bytes && bytes.byteLength <= IMAGE_LIMIT ? toDataUrl(bytes, mime) : null
  }
  await Promise.all(
    [...doc.querySelectorAll('img[src]')].map(async (img) => {
      const src = img.getAttribute('src') ?? ''
      if (/^data:image\//i.test(src)) return
      img.removeAttribute('src')
      const data = EXTERNAL.test(src) || src.startsWith('//') ? null : await embedImage(src)
      if (data) img.setAttribute('src', data)
      else img.replaceWith(img.getAttribute('alt') ?? '')
    }),
  )

  for (const el of doc.querySelectorAll('*')) {
    for (const name of URL_ATTRIBUTES) {
      const value = el.getAttribute(name)
      if (value === null || (name === 'src' && el.localName === 'img')) continue
      if (el.localName === 'a' && name === 'href') continue
      if (value.startsWith('#') || /^data:image\//i.test(value)) continue
      el.removeAttribute(name)
    }
    const style = el.getAttribute('style')
    if (style) el.setAttribute('style', cleanCss(style))
  }

  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? ''
    if (href.startsWith('#')) {
      a.setAttribute('target', '_self')
      continue
    }
    if (!EXTERNAL.test(href) && !href.startsWith('//')) {
      if (source.webUrl) a.setAttribute('href', source.webUrl(repoPath(source, file, href)))
      else a.removeAttribute('href')
    } else if (!/^(https?|mailto):/i.test(href)) a.removeAttribute('href')
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  }

  for (const style of doc.querySelectorAll('style')) style.textContent = cleanCss(style.textContent ?? '')
  const sheets = await Promise.all(
    stylesheets.map(async (href) => {
      const target = source.byPath.get(repoPath(source, file, href))
      if (!target || target.size > STYLE_LIMIT) return ''
      const bytes = await source.read(target.path).catch(() => null)
      return bytes ? cleanCss(new TextDecoder().decode(bytes)) : ''
    }),
  )
  for (const css of sheets.filter(Boolean)) {
    const style = doc.createElement('style')
    style.textContent = css
    doc.head.append(style)
  }
  const base = doc.createElement('base')
  base.setAttribute('href', 'about:srcdoc')
  base.setAttribute('target', '_blank')
  const policy = doc.createElement('meta')
  policy.setAttribute('http-equiv', 'Content-Security-Policy')
  policy.setAttribute('content', POLICY)
  doc.head.prepend(policy, base)

  return {
    html: `<!doctype html>${doc.documentElement.outerHTML}`,
    title: original.title.trim(),
    redirect,
    scripts: original.querySelectorAll('script').length,
    empty: isBlank(doc),
  }
}
