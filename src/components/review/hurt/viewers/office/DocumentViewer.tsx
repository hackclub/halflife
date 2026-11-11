import { Fragment, useEffect, type ReactNode } from 'react'
import type { ViewerProps } from '../../types'
import { useLoad } from '../../core/useLoad'
import { formatBytes } from '../../core/format'
import { Gate, Toolbar } from '../../ui/parts'
import { readOffice, type Block, type Run } from './ooxml'
import { IMAGE_MIME } from '../ImageViewer'

type Urls = Map<string, string>

function imageUrls(images: Map<string, Uint8Array>) {
  const urls: Urls = new Map()
  for (const [name, bytes] of images) {
    const type = IMAGE_MIME[name.split('.').pop()?.toLowerCase() ?? '']
    if (type && bytes.length)
      urls.set(name, URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type })))
  }
  return urls
}

function RunView({ run, urls }: { run: Run; urls: Urls }) {
  if ('image' in run) {
    const url = urls.get(run.image)
    return url ? (
      <img src={url} alt="" loading="lazy" width={run.width ?? undefined} />
    ) : (
      <span className="hurt-office__missing">[{run.image.split('/').pop()} cannot be shown]</span>
    )
  }
  let node: ReactNode = run.text === '\n' ? <br /> : run.text
  if (run.bold) node = <strong>{node}</strong>
  if (run.italic) node = <em>{node}</em>
  if (run.underline) node = <u>{node}</u>
  if (run.strike) node = <s>{node}</s>
  if (run.href)
    node = (
      <a href={run.href} target="_blank" rel="noopener noreferrer">
        {node}
      </a>
    )
  return <>{node}</>
}

function Paragraph({ block, urls }: { block: Extract<Block, { type: 'paragraph' }>; urls: Urls }) {
  const content = block.runs.map((run, i) => <RunView key={i} run={run} urls={urls} />)
  if (block.heading === 1) return <h1>{content}</h1>
  if (block.heading === 2) return <h2>{content}</h2>
  if (block.heading === 3) return <h3>{content}</h3>
  if (block.heading > 3) return <h4>{content}</h4>
  return <p>{content}</p>
}

function isEmpty(block: Block) {
  return block.type === 'paragraph' && block.runs.every((run) => 'text' in run && !run.text.trim())
}

function Blocks({ blocks, urls }: { blocks: Block[]; urls: Urls }) {
  const visible = blocks.filter((block) => !isEmpty(block))
  const out: ReactNode[] = []
  for (let i = 0; i < visible.length; i++) {
    const block = visible[i]
    if (block.type === 'table') {
      out.push(
        <table key={i}>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} colSpan={cell.span > 1 ? cell.span : undefined}>
                    <Blocks blocks={cell.blocks} urls={urls} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      )
    } else if (block.list) {
      const items: Extract<Block, { type: 'paragraph' }>[] = []
      while (i < visible.length) {
        const next = visible[i]
        if (next.type !== 'paragraph' || !next.list) break
        items.push(next)
        i++
      }
      i--
      const List = items[0].list!.ordered ? 'ol' : 'ul'
      out.push(
        <List key={i}>
          {items.map((item, k) => (
            <li key={k} style={item.list!.level ? { marginLeft: `${item.list!.level * 1.4}em` } : undefined}>
              {item.runs.map((run, r) => (
                <RunView key={r} run={run} urls={urls} />
              ))}
            </li>
          ))}
        </List>,
      )
    } else {
      out.push(<Paragraph key={i} block={block} urls={urls} />)
    }
  }
  return <>{out}</>
}

export default function DocumentViewer({ file, source }: ViewerProps) {
  const state = useLoad(
    async ({ signal }) => {
      const doc = await readOffice(await source.read(file.path, { signal }), file.name)
      signal.throwIfAborted()
      const urls = imageUrls(doc.images)
      const thumbnail = doc.thumbnail
        ? URL.createObjectURL(new Blob([doc.thumbnail as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }))
        : null
      return { doc, urls, thumbnail }
    },
    [source.id, file.path],
  )

  useEffect(() => {
    if (state.status !== 'ready') return
    const { urls, thumbnail } = state.value
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
      if (thumbnail) URL.revokeObjectURL(thumbnail)
    }
  }, [state])

  const slides = state.status === 'ready' && state.value.doc.sections.length > 1 ? state.value.doc.sections.length : 0

  return (
    <div className="hurt-doc">
      <Toolbar
        title={file.name}
        meta={slides ? `${slides} slides · ${formatBytes(file.size)}` : formatBytes(file.size)}
      />
      <Gate state={state}>
        {({ doc, urls, thumbnail }) => (
          <>
            <p className="hurt-note">Text and pictures only. Layout, fonts and page breaks are not shown.</p>
            <div className="hurt-doc__body hurt-md hurt-office">
              {thumbnail && (
                <figure className="hurt-office__thumbnail">
                  <img src={thumbnail} alt="" />
                  <figcaption>Preview saved with the file</figcaption>
                </figure>
              )}
              {doc.sections.map((section, i) => (
                <Fragment key={i}>
                  {section.title && <p className="hurt-office__label">{section.title}</p>}
                  <Blocks blocks={section.blocks} urls={urls} />
                </Fragment>
              ))}
              {doc.truncated && (
                <p className="hurt-office__label">This document is long, so only the start is shown.</p>
              )}
            </div>
          </>
        )}
      </Gate>
    </div>
  )
}
