export interface SNode {
  name: string
  args: string[]
  children: SNode[]
}

const MAX_NODES = 4_000_000
const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v' }

const isSpace = (c: number) => c === 32 || (c >= 9 && c <= 13)

export function parseSexpr(src: string): SNode {
  const root: SNode = { name: '', args: [], children: [] }
  const stack: SNode[] = [root]
  const len = src.length
  let count = 0
  let i = 0
  let naming = false
  while (i < len) {
    const c = src.charCodeAt(i)
    if (isSpace(c)) {
      i++
    } else if (c === 40) {
      if (++count > MAX_NODES) throw new Error('This LibrePCB file is too large to read.')
      const node: SNode = { name: '', args: [], children: [] }
      stack[stack.length - 1].children.push(node)
      stack.push(node)
      naming = true
      i++
    } else if (c === 41) {
      if (stack.length > 1) stack.pop()
      naming = false
      i++
    } else {
      let value = ''
      if (c === 34) {
        i++
        let start = i
        while (i < len && src.charCodeAt(i) !== 34) {
          if (src.charCodeAt(i) === 92) {
            value += src.slice(start, i)
            const next = src[i + 1] ?? ''
            value += ESCAPES[next] ?? next
            i += 2
            start = i
          } else i++
        }
        value += src.slice(start, i)
        i++
      } else {
        const start = i
        while (i < len && !isSpace(src.charCodeAt(i)) && src.charCodeAt(i) !== 40 && src.charCodeAt(i) !== 41) i++
        value = src.slice(start, i)
      }
      const top = stack[stack.length - 1]
      if (naming) top.name = value
      else top.args.push(value)
      naming = false
    }
  }
  return root
}

export function child(node: SNode | undefined, name: string) {
  return node?.children.find((c) => c.name === name)
}

export function children(node: SNode | undefined, name: string) {
  return node ? node.children.filter((c) => c.name === name) : []
}

export function value(node: SNode | undefined, name: string, index = 0) {
  return child(node, name)?.args[index]
}

export function number(node: SNode | undefined, name: string, fallback = 0, index = 0) {
  const v = Number(value(node, name, index))
  return Number.isFinite(v) ? v : fallback
}

export function point(node: SNode | undefined, name = 'position'): [number, number] {
  return [number(node, name, 0, 0), number(node, name, 0, 1)]
}

export function flag(node: SNode | undefined, name: string) {
  return value(node, name) === 'true'
}
