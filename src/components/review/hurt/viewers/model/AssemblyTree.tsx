import { memo, useEffect, useMemo, useRef, useState } from 'react'
import HurtIcon from '../../ui/HurtIcon'
import type { ModelData, ModelNode } from './analyze'

interface Row {
  key: string
  parent: string | null
  depth: number
  name: string
  parts: number[]
  children: string[]
  part: number | null
}

const ROW_HEIGHT = 26
const OVERSCAN = 10

function index(model: ModelData) {
  const rows = new Map<string, Row>()
  const order: string[] = []
  const partRow = new Map<number, string>()

  const walk = (node: ModelNode, key: string, parent: string | null, depth: number): Row => {
    const row: Row = { key, parent, depth, name: node.name, parts: [], children: [], part: null }
    rows.set(key, row)
    order.push(key)
    if (node.children.length === 0 && node.parts.length === 1) {
      row.part = node.parts[0]
      row.parts = [node.parts[0]]
      row.name ||= model.parts[node.parts[0]].name
      partRow.set(node.parts[0], key)
      return row
    }
    row.name ||= 'Assembly'
    node.parts.forEach((part, i) => {
      const leaf = walk({ name: model.parts[part].name, parts: [part], children: [] }, `${key}.p${i}`, key, depth + 1)
      row.children.push(leaf.key)
      row.parts.push(part)
    })
    node.children.forEach((child, i) => {
      const sub = walk(child, `${key}.${i}`, key, depth + 1)
      row.children.push(sub.key)
      row.parts.push(...sub.parts)
    })
    return row
  }
  walk(model.root, 'r', null, 0)
  return { rows, order, partRow }
}

export default memo(function AssemblyTree({
  model,
  hidden,
  selected,
  reveal,
  onSelect,
  onVisibility,
  onFocus,
}: {
  model: ModelData
  hidden: Set<number>
  selected: Set<number>
  reveal: number | null
  onSelect: (parts: number[], additive: boolean) => void
  onVisibility: (parts: number[], visible: boolean) => void
  onFocus: (parts: number[]) => void
}) {
  const { rows, order, partRow } = useMemo(() => index(model), [model])
  const [expanded, setExpanded] = useState(() => new Set(order.filter((k) => rows.get(k)!.depth < 2)))
  const [query, setQuery] = useState('')
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(400)
  const list = useRef<HTMLDivElement>(null)

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle) {
      const keep = new Set<string>()
      for (const key of order) {
        const row = rows.get(key)!
        if (!row.name.toLowerCase().includes(needle)) continue
        for (let k: string | null = key; k && !keep.has(k); k = rows.get(k)!.parent) keep.add(k)
      }
      return order.filter((k) => keep.has(k))
    }
    const out: string[] = []
    const add = (key: string) => {
      out.push(key)
      if (expanded.has(key)) for (const child of rows.get(key)!.children) add(child)
    }
    add('r')
    return out
  }, [order, rows, expanded, query])

  useEffect(() => {
    const el = list.current
    if (!el) return
    const observer = new ResizeObserver(() => setHeight(el.clientHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (reveal === null) return
    const key = partRow.get(reveal)
    if (!key) return
    setExpanded((current) => {
      const next = new Set(current)
      for (let k = rows.get(key)!.parent; k; k = rows.get(k)!.parent) next.add(k)
      return next
    })
  }, [reveal, partRow, rows])

  useEffect(() => {
    if (reveal === null) return
    const key = partRow.get(reveal)
    const position = key ? visible.indexOf(key) : -1
    const el = list.current
    if (position < 0 || !el) return
    const top = position * ROW_HEIGHT
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - ROW_HEIGHT)
      el.scrollTop = top - el.clientHeight / 2
  }, [reveal, visible, partRow])

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(visible.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN)

  return (
    <div className="hurt-tree">
      <div className="hurt-tree__search">
        <HurtIcon name="search" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a part"
          aria-label="Find a part"
        />
      </div>
      <div ref={list} className="hurt-tree__list" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} role="tree">
        <div style={{ height: visible.length * ROW_HEIGHT, position: 'relative' }}>
          {visible.slice(start, end).map((key, i) => {
            const row = rows.get(key)!
            const allHidden = row.parts.every((p) => hidden.has(p))
            const isSelected = row.parts.length > 0 && row.parts.every((p) => selected.has(p))
            const color = row.part !== null ? model.parts[row.part].color : null
            return (
              <div
                key={key}
                role="treeitem"
                aria-selected={isSelected}
                aria-expanded={row.children.length ? expanded.has(key) : undefined}
                className={`hurt-tree__row${isSelected ? ' is-selected' : ''}${allHidden ? ' is-hidden' : ''}`}
                style={{ top: (start + i) * ROW_HEIGHT, paddingLeft: `${0.4 + row.depth * 0.9}rem` }}
                onClick={(e) => onSelect(row.parts, e.shiftKey || e.metaKey || e.ctrlKey)}
                onDoubleClick={() => onFocus(row.parts)}
              >
                {row.children.length > 0 ? (
                  <button
                    type="button"
                    className="hurt-tree__chevron"
                    aria-label={expanded.has(key) ? 'Collapse' : 'Expand'}
                    onClick={(e) => {
                      e.stopPropagation()
                      setExpanded((current) => {
                        const next = new Set(current)
                        if (next.has(key)) next.delete(key)
                        else next.add(key)
                        return next
                      })
                    }}
                  >
                    <HurtIcon name={expanded.has(key) ? 'chevron-down' : 'chevron-right'} />
                  </button>
                ) : (
                  <span className="hurt-tree__chevron" />
                )}
                <button
                  type="button"
                  className="hurt-tree__eye"
                  aria-label={allHidden ? 'Show' : 'Hide'}
                  onClick={(e) => {
                    e.stopPropagation()
                    onVisibility(row.parts, allHidden)
                  }}
                >
                  <HurtIcon name={allHidden ? 'eye-off' : 'eye'} />
                </button>
                {row.part !== null && (
                  <span
                    className="hurt-tree__swatch"
                    style={{ background: color === null ? undefined : `#${color.toString(16).padStart(6, '0')}` }}
                  />
                )}
                <span className="hurt-tree__name">{row.name}</span>
                {row.children.length > 0 && <span className="hurt-tree__count">{row.parts.length}</span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
})
