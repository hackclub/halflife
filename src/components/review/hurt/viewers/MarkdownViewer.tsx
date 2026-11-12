import { useEffect, useState } from 'react'
import type { FileSource, HurtFile, ViewerProps } from '../types'
import { useLoad } from '../core/useLoad'
import { decodeText } from '../core/text'
import { resolvePath } from '../core/source'
import { Gate, ToolButton, Toolbar } from '../ui/parts'
import { IMAGE_MIME } from './ImageViewer'

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i
const ALERT = /^\[!(note|tip|important|warning|caution)\]\s*/i
const GITHUB_VIDEO = /^https:\/\/github\.com\/(?:user-attachments\/assets|[^/]+\/[^/]+\/assets\/\d+)\/[0-9a-f-]{36}$/i
const GITHUB_ATTACHMENT = /^https:\/\/github\.com\/user-attachments\/assets\/([0-9a-f-]{36})$/i
const POINTER_SIZE = 200
const MEDIA_ATTRIBUTES = [
  ['img, video, audio, source, track', 'src'],
  ['video', 'poster'],
] as const

async function render(source: FileSource, file: HurtFile, text: string, signal: AbortSignal) {
  const [{ marked }, { default: DOMPurify }] = await Promise.all([import('marked'), import('dompurify')])
  const html = await marked.parse(text, { gfm: true, breaks: false })
  const template = document.createElement('template')
  template.innerHTML = DOMPurify.sanitize(html, {
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'link', 'meta', 'form', 'button', 'textarea', 'select', 'option', 'dialog'],
    FORBID_ATTR: ['style', 'class', 'action', 'formaction', 'popover'],
    SANITIZE_NAMED_PROPS: true,
  })
  const content = template.content
  const repoLink = source.webUrl
    ? new RegExp(`^https?://github\\.com/${escapeRegExp(source.label)}/(?:blob|tree|raw)/[^/]+/([^?#]+)`, 'i')
    : null
  const blobs: string[] = []
  const pending: Promise<void>[] = []

  const resolve = (value: string) => {
    const path = safeDecode(value.split(/[?#]/)[0])
    return path.startsWith('/') ? path.replace(/^\/+/, '') : resolvePath(file.dir, path)
  }

  const repoPath = (value: string) => {
    if (value.startsWith('data:')) return null
    if (!EXTERNAL.test(value)) return resolve(value)
    const inRepo = repoLink?.exec(value)?.[1]
    return inRepo ? safeDecode(inRepo) : null
  }

  const assetUrl = async (path: string) => {
    if (!source.rawUrl) {
      if (!source.byPath.has(path)) return null
      const type = IMAGE_MIME[path.split('.').pop()?.toLowerCase() ?? ''] ?? ''
      const url = URL.createObjectURL(new Blob([await source.read(path, { signal })], { type }))
      blobs.push(url)
      return url
    }
    const size = source.byPath.get(path)?.size ?? Infinity
    if (size <= POINTER_SIZE) await source.head?.(path, 1, { signal }).catch(() => null)
    return source.rawUrl(path)
  }

  const rewrite = async (value: string) => {
    const path = repoPath(value)
    return path === null ? value : assetUrl(path).catch(() => null)
  }

  for (const img of content.querySelectorAll('img')) {
    img.setAttribute('loading', 'lazy')
    const id = GITHUB_ATTACHMENT.exec(img.getAttribute('src') ?? '')?.[1]
    if (id && source.attachmentUrl) img.setAttribute('data-hurt-fallback', source.attachmentUrl(file.path, id))
  }
  for (const [selector, attribute] of MEDIA_ATTRIBUTES) {
    for (const el of content.querySelectorAll(selector)) {
      const value = el.getAttribute(attribute)
      if (!value) continue
      pending.push(
        rewrite(value).then((url) => (url ? el.setAttribute(attribute, url) : el.removeAttribute(attribute))),
      )
    }
  }
  for (const el of content.querySelectorAll('[srcset]')) {
    const candidates = el
      .getAttribute('srcset')!
      .split(',')
      .map((c) => c.trim().split(/\s+/))
    pending.push(
      Promise.all(candidates.map(([url]) => rewrite(url))).then((urls) => {
        const srcset = candidates.flatMap(([, ...descriptor], i) =>
          urls[i] ? [[urls[i], ...descriptor].join(' ')] : [],
        )
        if (srcset.length) el.setAttribute('srcset', srcset.join(', '))
        else el.removeAttribute('srcset')
      }),
    )
  }

  for (const input of content.querySelectorAll('input')) {
    if (input.type === 'checkbox') input.setAttribute('disabled', '')
    else input.remove()
  }

  const slugs = new Map<string, number>()
  for (const heading of content.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const base = (heading.textContent ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
      .replace(/ /g, '-')
    const n = slugs.get(base) ?? 0
    slugs.set(base, n + 1)
    if (!heading.id) heading.id = `user-content-${n ? `${base}-${n}` : base}`
  }

  for (const quote of content.querySelectorAll('blockquote')) {
    const p = quote.firstElementChild
    const first = p?.tagName === 'P' ? p.firstChild : null
    const match = first?.nodeType === Node.TEXT_NODE ? ALERT.exec(first.textContent ?? '') : null
    if (!p || !first || !match) continue
    first.textContent = first.textContent!.slice(match[0].length)
    if (!p.textContent?.trim() && !p.children.length) p.remove()
    const kind = match[1].toLowerCase()
    const title = document.createElement('p')
    title.className = 'hurt-md__alert-title'
    title.textContent = kind[0].toUpperCase() + kind.slice(1)
    quote.prepend(title)
    quote.className = `hurt-md__alert hurt-md__alert--${kind}`
  }

  for (const a of content.querySelectorAll('p > a')) {
    const href = a.getAttribute('href')
    const p = a.parentElement!
    if (!href || !GITHUB_VIDEO.test(href) || a.textContent?.trim() !== href || p.textContent?.trim() !== href) continue
    const video = document.createElement('video')
    video.setAttribute('src', href)
    video.setAttribute('controls', '')
    video.setAttribute('preload', 'metadata')
    p.before(video)
  }

  for (const a of content.querySelectorAll('a')) {
    const href = a.getAttribute('href')
    if (!href) continue
    if (href.startsWith('#')) {
      a.setAttribute('data-hurt-anchor', safeDecode(href.slice(1)))
      continue
    }
    const inRepo = repoLink?.exec(href)?.[1]
    const path = inRepo ? safeDecode(inRepo).replace(/\/$/, '') : !EXTERNAL.test(href) ? resolve(href) : null
    if (path !== null && source.byPath.has(path)) {
      a.setAttribute('data-hurt-path', path)
      a.setAttribute('href', source.webUrl?.(path) ?? '#')
      continue
    }
    if (!EXTERNAL.test(href) && source.webUrl) a.setAttribute('href', source.webUrl(resolve(href)))
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  }

  try {
    await Promise.all(pending)
  } catch (error) {
    blobs.forEach((url) => URL.revokeObjectURL(url))
    throw error
  }
  return { html: template.innerHTML, blobs }
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function scrollToAnchor(body: HTMLElement, id: string) {
  const target =
    body.querySelector(`[id="user-content-${CSS.escape(id.toLowerCase())}"]`) ??
    body.querySelector(`[id="user-content-${CSS.escape(id)}"], [name="user-content-${CSS.escape(id)}"]`)
  target?.scrollIntoView({ block: 'start' })
}

export default function MarkdownViewer({ file, source, onOpen }: ViewerProps) {
  const [raw, setRaw] = useState(false)
  const state = useLoad(
    async ({ signal }) => {
      const { text } = decodeText(await source.read(file.path, { signal }))
      return { text, ...(await render(source, file, text, signal)) }
    },
    [source.id, file.path],
  )

  useEffect(() => {
    if (state.status !== 'ready') return
    const { blobs } = state.value
    return () => blobs.forEach((url) => URL.revokeObjectURL(url))
  }, [state])

  return (
    <div className="hurt-doc">
      <Toolbar title={file.name} meta={file.dir || undefined}>
        <ToolButton
          icon="code"
          label={raw ? 'Show rendered' : 'Show Markdown source'}
          active={raw}
          onClick={() => setRaw((v) => !v)}
        />
      </Toolbar>
      <Gate state={state}>
        {({ text, html }) =>
          raw ? (
            <pre className="hurt-doc__raw">{text}</pre>
          ) : (
            <div
              className="hurt-doc__body hurt-md"
              onClick={(event) => {
                const target = event.target as HTMLElement
                const anchor = target.closest<HTMLAnchorElement>('a[data-hurt-anchor]')
                if (anchor) {
                  event.preventDefault()
                  scrollToAnchor(event.currentTarget, anchor.dataset.hurtAnchor!)
                  return
                }
                const link = target.closest<HTMLAnchorElement>('a[data-hurt-path]')
                if (!link || event.metaKey || event.ctrlKey) return
                event.preventDefault()
                onOpen(link.dataset.hurtPath!)
              }}
              onErrorCapture={(event) => {
                const img = event.target as HTMLElement
                const fallback = img.dataset.hurtFallback
                if (img.tagName !== 'IMG' || !fallback) return
                img.removeAttribute('data-hurt-fallback')
                img.setAttribute('src', fallback)
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )
        }
      </Gate>
    </div>
  )
}
