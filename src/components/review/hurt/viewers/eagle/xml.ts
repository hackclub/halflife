export interface XNode {
  name: string
  attrs: Record<string, string>
  children: XNode[]
  text: string
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decode(value: string) {
  if (!value.includes('&')) return value
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    }
    return ENTITIES[body] ?? whole
  })
}

const MAX_NODES = 4_000_000
const CLOSE_SEARCH = 64

const isSpace = (c: number) => c === 32 || (c >= 9 && c <= 13)

function readAttrs(body: string, from: number) {
  const attrs: Record<string, string> = {}
  const len = body.length
  let i = from
  while (i < len) {
    while (i < len && isSpace(body.charCodeAt(i))) i++
    const start = i
    while (i < len && body.charCodeAt(i) !== 61 && !isSpace(body.charCodeAt(i))) i++
    const name = body.slice(start, i)
    while (i < len && isSpace(body.charCodeAt(i))) i++
    if (body.charCodeAt(i) !== 61) continue
    i++
    while (i < len && isSpace(body.charCodeAt(i))) i++
    const quote = body[i]
    if (quote !== '"' && quote !== "'") continue
    const end = body.indexOf(quote, i + 1)
    const stop = end < 0 ? len : end
    if (name) attrs[name] = decode(body.slice(i + 1, stop))
    i = stop + 1
  }
  return attrs
}

export function parseXml(src: string): { root: XNode; complete: boolean } {
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' }
  const stack: XNode[] = [root]
  let at = 0
  let count = 0
  let cut = false
  const len = src.length
  const skipTo = (token: string, from: number) => {
    const end = src.indexOf(token, from)
    if (end < 0) cut = true
    return end < 0 ? len : end + token.length
  }
  while (at < len) {
    const lt = src.indexOf('<', at)
    if (lt < 0) break
    if (lt > at) {
      const top = stack[stack.length - 1]
      const chunk = src.slice(at, lt)
      if (top !== root && (top.text || /\S/.test(chunk))) top.text += decode(chunk)
    }
    const next = src.charCodeAt(lt + 1)
    if (next === 63) {
      at = skipTo('?>', lt)
    } else if (next === 33) {
      if (src.startsWith('<!--', lt)) {
        at = skipTo('-->', lt + 4)
      } else if (src.startsWith('<![CDATA[', lt)) {
        at = skipTo(']]>', lt + 9)
        stack[stack.length - 1].text += src.slice(lt + 9, Math.max(lt + 9, at - 3))
      } else {
        let depth = 0
        let i = lt + 2
        for (; i < len; i++) {
          const c = src.charCodeAt(i)
          if (c === 91) depth++
          else if (c === 93) depth--
          else if (c === 62 && depth <= 0) break
        }
        if (i >= len) cut = true
        at = i + 1
      }
    } else if (next === 47) {
      at = skipTo('>', lt)
      const name = src.slice(lt + 2, at - 1).trim()
      for (let i = stack.length - 1; i > 0 && i >= stack.length - CLOSE_SEARCH; i--) {
        if (stack[i].name === name) {
          stack.length = i
          break
        }
      }
    } else {
      let i = lt + 1
      let quote = 0
      for (; i < len; i++) {
        const c = src.charCodeAt(i)
        if (quote) {
          if (c === quote) quote = 0
        } else if (c === 34 || c === 39) quote = c
        else if (c === 62) break
      }
      if (i >= len) {
        cut = true
        break
      }
      const body = src.slice(lt + 1, i)
      const selfClosing = body.endsWith('/')
      const inner = selfClosing ? body.slice(0, -1) : body
      let space = 0
      while (space < inner.length && !isSpace(inner.charCodeAt(space))) space++
      const name = inner.slice(0, space)
      const attrs = space < inner.length ? readAttrs(inner, space) : {}
      if (++count > MAX_NODES) throw new Error('This file has too many elements to draw in the browser.')
      const node: XNode = { name, attrs, children: [], text: '' }
      stack[stack.length - 1].children.push(node)
      if (!selfClosing) stack.push(node)
      at = i + 1
    }
  }
  return { root, complete: !cut && stack.length === 1 }
}

export function child(node: XNode | undefined, name: string) {
  return node?.children.find((c) => c.name === name)
}

export function children(node: XNode | undefined, name: string) {
  return node ? node.children.filter((c) => c.name === name) : []
}

export function path(node: XNode | undefined, ...names: string[]) {
  let current = node
  for (const name of names) current = child(current, name)
  return current
}
