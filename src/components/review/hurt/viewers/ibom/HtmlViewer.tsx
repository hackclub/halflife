import { useState } from 'react'
import type { ViewerProps } from '../../types'
import { useLoad } from '../../core/useLoad'
import { Gate, ToolButton, Toolbar } from '../../ui/parts'
import TextViewer from '../TextViewer'
import { staticPage } from './sanitize'

const RENDER_LIMIT = 8 * 1024 * 1024
const SCRIPTED = 100

export default function HtmlViewer(props: ViewerProps) {
  const { file, source } = props
  const [mode, setMode] = useState<'rendered' | 'source' | null>(null)
  const state = useLoad(
    async ({ signal }) => {
      const bytes = await source.read(file.path, { signal })
      if (bytes.byteLength > RENDER_LIMIT) return null
      return staticPage(source, file, new TextDecoder().decode(bytes))
    },
    [source.id, file.path],
  )
  const page = state.status === 'ready' ? state.value : null
  const current =
    mode ??
    (state.status === 'ready' && (!page || page.redirect || page.empty || page.scripts > SCRIPTED)
      ? 'source'
      : 'rendered')
  const toggle = (
    <ToolButton
      icon="code"
      label={current === 'source' ? 'Show rendered page' : 'Show page source'}
      active={current === 'source'}
      disabled={state.status === 'ready' && !page}
      onClick={() => setMode(current === 'source' ? 'rendered' : 'source')}
    />
  )
  const redirect = page?.redirect ? safeUrl(page.redirect) : null

  if (current === 'source') {
    return (
      <div className="hurt-html">
        {redirect && <Redirect url={redirect} />}
        <TextViewer {...props} tools={toggle} />
      </div>
    )
  }
  return (
    <div className="hurt-html">
      <Toolbar
        title={file.name}
        meta={
          page
            ? [
                page.title,
                'Static preview',
                page.scripts ? `${page.scripts} ${page.scripts === 1 ? 'script' : 'scripts'} removed` : '',
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
      >
        {toggle}
      </Toolbar>
      {redirect && <Redirect url={redirect} />}
      <Gate state={state}>
        {(value) =>
          value && (
            <iframe
              className="hurt-html__frame"
              title={file.name}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              srcDoc={value.html}
            />
          )
        }
      </Gate>
    </div>
  )
}

function safeUrl(value: string) {
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) ? url : null
  } catch {
    return null
  }
}

function Redirect({ url }: { url: URL }) {
  return (
    <p className="hurt-note">
      This page only forwards to{' '}
      <a href={url.href} target="_blank" rel="noopener noreferrer">
        {url.host}
      </a>
      .
    </p>
  )
}
