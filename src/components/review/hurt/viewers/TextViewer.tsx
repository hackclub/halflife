import { useMemo, useState, type ReactNode } from 'react'
import type { LanguageFn } from 'highlight.js'
import type { ViewerProps } from '../types'
import { useLoad } from '../core/useLoad'
import { formatBytes, plural } from '../core/format'
import { decodeText } from '../core/text'
import { codeCadOf } from '../core/codecad'
import { Gate, ToolButton, Toolbar } from '../ui/parts'

const HIGHLIGHT_LIMIT = 400_000
const DISPLAY_LIMIT = 3_000_000

type Loader = () => Promise<{ default: LanguageFn }>

const GRAMMARS: Record<string, Loader> = {
  javascript: () => import('highlight.js/lib/languages/javascript'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  python: () => import('highlight.js/lib/languages/python'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  java: () => import('highlight.js/lib/languages/java'),
  go: () => import('highlight.js/lib/languages/go'),
  rust: () => import('highlight.js/lib/languages/rust'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  php: () => import('highlight.js/lib/languages/php'),
  lua: () => import('highlight.js/lib/languages/lua'),
  swift: () => import('highlight.js/lib/languages/swift'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  dart: () => import('highlight.js/lib/languages/dart'),
  groovy: () => import('highlight.js/lib/languages/groovy'),
  bash: () => import('highlight.js/lib/languages/bash'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  dos: () => import('highlight.js/lib/languages/dos'),
  sql: () => import('highlight.js/lib/languages/sql'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  ini: () => import('highlight.js/lib/languages/ini'),
  xml: () => import('highlight.js/lib/languages/xml'),
  css: () => import('highlight.js/lib/languages/css'),
  scss: () => import('highlight.js/lib/languages/scss'),
  less: () => import('highlight.js/lib/languages/less'),
  diff: () => import('highlight.js/lib/languages/diff'),
  graphql: () => import('highlight.js/lib/languages/graphql'),
  json: () => import('highlight.js/lib/languages/json'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  cmake: () => import('highlight.js/lib/languages/cmake'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  verilog: () => import('highlight.js/lib/languages/verilog'),
  vhdl: () => import('highlight.js/lib/languages/vhdl'),
  armasm: () => import('highlight.js/lib/languages/armasm'),
  tcl: () => import('highlight.js/lib/languages/tcl'),
  gcode: () => import('highlight.js/lib/languages/gcode'),
  lisp: () => import('highlight.js/lib/languages/lisp'),
  latex: () => import('highlight.js/lib/languages/latex'),
  julia: () => import('highlight.js/lib/languages/julia'),
  elixir: () => import('highlight.js/lib/languages/elixir'),
  haskell: () => import('highlight.js/lib/languages/haskell'),
  scala: () => import('highlight.js/lib/languages/scala'),
  openscad: () => import('highlight.js/lib/languages/openscad'),
}

const LANGUAGE: Record<string, string> = {}
const languages: [string, string][] = [
  ['javascript', 'js mjs cjs jsx jscad'],
  ['typescript', 'ts tsx'],
  ['python', 'py pyw pyi'],
  ['cpp', 'ino pde cc cpp cxx hh hpp hxx'],
  ['c', 'c h dts dtsi overlay keymap inc'],
  ['openscad', 'scad'],
  ['csharp', 'cs'],
  ['java', 'java'],
  ['go', 'go'],
  ['rust', 'rs'],
  ['ruby', 'rb'],
  ['php', 'php'],
  ['lua', 'lua'],
  ['swift', 'swift'],
  ['kotlin', 'kt kts'],
  ['dart', 'dart'],
  ['groovy', 'groovy gradle'],
  ['bash', 'sh bash zsh fish'],
  ['powershell', 'ps1'],
  ['dos', 'bat cmd'],
  ['sql', 'sql'],
  ['yaml', 'yaml yml'],
  ['ini', 'toml ini cfg conf properties pro defconfig ioc defaults shield sysbuild'],
  [
    'xml',
    'xml html htm vue svelte lbr uvprojx uvoptx ewp eww xpr drawio launch iml plist storyboard xib xcworkspacedata xcscheme xslt',
  ],
  ['css', 'css'],
  ['scss', 'scss sass'],
  ['less', 'less'],
  ['diff', 'diff patch'],
  ['graphql', 'graphql gql'],
  ['json', 'json jsonc json5 gbrjob kicad_prl kicad_pro lck code-workspace vil hjson ipynb excalidraw webmanifest'],
  ['markdown', 'md markdown mdx'],
  ['makefile', 'mk makefile make d'],
  ['cmake', 'cmake'],
  ['verilog', 'v sv svh vh'],
  ['vhdl', 'vhd vhdl'],
  ['armasm', 's asm'],
  ['tcl', 'tcl xdc'],
  ['gcode', 'gcode nc ngc tap gc'],
  ['lisp', 'kicad_sym kicad_mod kicad_dru kicad_sch-bak kicad_pcb-bak kicad_wks dsn ses'],
  ['latex', 'tex'],
  ['julia', 'jl'],
  ['elixir', 'ex exs'],
  ['haskell', 'hs'],
  ['scala', 'scala'],
]
for (const [language, extensions] of languages) for (const ext of extensions.split(' ')) LANGUAGE[ext] = language

const NAMED: Record<string, string> = { makefile: 'makefile', dockerfile: 'dockerfile', 'cmakelists.txt': 'cmake' }

async function highlight(text: string, language: string | undefined) {
  if (!language || !GRAMMARS[language] || text.length > HIGHLIGHT_LIMIT) return null
  const hljs = (await import('highlight.js/lib/core')).default
  if (!hljs.getLanguage(language)) hljs.registerLanguage(language, (await GRAMMARS[language]()).default)
  return hljs.highlight(text, { language, ignoreIllegals: true }).value
}

export default function TextViewer({ file, source, onOpen, tools }: ViewerProps & { tools?: ReactNode }) {
  const [wrap, setWrap] = useState(false)
  const [pretty, setPretty] = useState(false)
  const [copied, setCopied] = useState(false)
  const state = useLoad(
    async ({ signal, progress }) => {
      const bytes = await source.read(file.path, {
        signal,
        onProgress: (l, t) => progress(t ? l / t : null, 'Downloading'),
      })
      const truncated = bytes.byteLength > DISPLAY_LIMIT
      return { ...decodeText(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, DISPLAY_LIMIT))), truncated }
    },
    [source.id, file.path],
  )

  const minifiedJson =
    state.status === 'ready' &&
    file.ext === 'json' &&
    state.value.text.length > 2000 &&
    state.value.text.split('\n', 6).length < 5
  const text = useMemo(() => {
    if (state.status !== 'ready') return ''
    if (!pretty) return state.value.text
    try {
      return JSON.stringify(JSON.parse(state.value.text), null, 2)
    } catch {
      return state.value.text
    }
  }, [state, pretty])

  const language = LANGUAGE[file.ext] ?? NAMED[file.name.toLowerCase()]
  const cad = useMemo(
    () => (state.status === 'ready' ? codeCadOf(file, state.value.text, source.files, !state.value.truncated) : null),
    [state, file, source.files],
  )
  const html = useLoad(() => highlight(text, language), [text, language])
  const lines = useMemo(() => (text ? text.split('\n').length : 0), [text])
  const encoding =
    state.status === 'ready' && state.value.encoding !== 'utf-8' ? state.value.encoding.toUpperCase() : null

  return (
    <div className="hurt-text">
      <Toolbar
        title={file.name}
        meta={[plural(lines, 'line'), formatBytes(file.size), cad?.label ?? language, encoding]
          .filter(Boolean)
          .join(' · ')}
      >
        {minifiedJson && (
          <ToolButton
            icon="code"
            label={pretty ? 'Show as saved' : 'Format JSON'}
            active={pretty}
            onClick={() => setPretty((v) => !v)}
            text
          />
        )}
        <ToolButton icon="wrap" label="Wrap long lines" active={wrap} onClick={() => setWrap((v) => !v)} />
        <ToolButton
          icon={copied ? 'check' : 'copy'}
          label="Copy contents"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        />
        {tools}
      </Toolbar>
      {cad && (cad.note || cad.facts.length > 0) && (
        <p className="hurt-note hurt-text__cad">
          {cad.facts.length > 0 && <strong>{cad.facts.join(' · ')}</strong>}
          {cad.note && <span>{cad.note}</span>}
          {cad.outputs.map((output) => (
            <button
              key={output.path}
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => onOpen(output.path)}
            >
              Open {output.name}
            </button>
          ))}
        </p>
      )}
      <Gate state={state}>
        {(value) => (
          <div className={wrap ? 'hurt-text__body is-wrapped' : 'hurt-text__body'}>
            {!wrap && (
              <pre className="hurt-text__gutter" aria-hidden="true">
                {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
              </pre>
            )}
            <pre className="hurt-text__code">
              {html.status === 'ready' && html.value !== null ? (
                <code className="hljs" dangerouslySetInnerHTML={{ __html: html.value }} />
              ) : (
                <code>{text}</code>
              )}
            </pre>
            {value.truncated && <p className="hurt-text__note">Showing the first {formatBytes(DISPLAY_LIMIT)}.</p>}
          </div>
        )}
      </Gate>
    </div>
  )
}
