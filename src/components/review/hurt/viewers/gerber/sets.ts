import type { HurtFile } from '../../types'

export interface GerberBoardSet {
  dir: string
  stem: string
  files: HurtFile[]
}

const DRILL_EXTENSIONS = new Set(['drl', 'xln', 'exc'])
const EAGLE_CAM = new Set(['cmp', 'sol', 'stc', 'sts', 'plc', 'pls', 'crc', 'crs'])
const MAX_DRILL_TEXT = 2 * 1024 * 1024
const LAYER_SUFFIX =
  /[-_]((F|B|In\d+)[_.][\w.]+|Edge[_.]?Cuts|User[_.]\w+|\w+[_.]User|Margin|N?PTH(-drl(_map)?)?|drl_map|job|Cu(Top|Bottom|In\d+)|(Silk|Mask|Paste)(Top|Bottom))$/i

const boardsCache = new WeakMap<HurtFile[], GerberBoardSet[]>()

const isDrill = (f: HurtFile) => DRILL_EXTENSIONS.has(f.ext)
const parentOf = (dir: string) => (dir ? dir.slice(0, Math.max(0, dir.lastIndexOf('/'))) : null)

function stemOf(f: HurtFile) {
  const base = f.ext ? f.name.slice(0, -f.ext.length - 1) : f.name
  const match = LAYER_SUFFIX.exec(base)
  return match ? base.slice(0, match.index) : ''
}

function nearDirs(dir: string, other: string) {
  return other === parentOf(dir) || parentOf(other) === parentOf(dir) || parentOf(other) === dir
}

function foldDrillFolders(byDir: Map<string, HurtFile[]>) {
  for (const [dir, list] of [...byDir]) {
    if (!list.every(isDrill)) continue
    const near = [...byDir.keys()].filter((other) => {
      const files = byDir.get(other)!
      return other !== dir && nearDirs(dir, other) && !files.some(isDrill)
    })
    const stems = new Set(list.map((f) => stemOf(f).toLowerCase()).filter(Boolean))
    const matches =
      near.length === 1
        ? near
        : near.filter((other) => byDir.get(other)!.some((f) => stems.has(stemOf(f).toLowerCase())))
    if (matches.length !== 1) continue
    byDir.get(matches[0])!.push(...list)
    byDir.delete(dir)
  }
}

function splitByStem(dir: string, list: HurtFile[]): GerberBoardSet[] {
  const stems = new Map<string, string>()
  for (const f of list) {
    const stem = stemOf(f)
    if (stem && !stems.has(stem.toLowerCase())) stems.set(stem.toLowerCase(), stem)
  }
  if (stems.size < 2) return [{ dir, stem: '', files: list }]
  const shared = list.filter((f) => !stemOf(f))
  return [...stems].map(([key, stem]) => ({
    dir,
    stem,
    files: [...list.filter((f) => stemOf(f).toLowerCase() === key), ...shared],
  }))
}

export function gerberBoards(files: HurtFile[]): GerberBoardSet[] {
  const cached = boardsCache.get(files)
  if (cached) return cached
  const byDir = new Map<string, HurtFile[]>()
  for (const f of files) if (f.kind === 'gerber') byDir.set(f.dir, [...(byDir.get(f.dir) ?? []), f])
  foldDrillFolders(byDir)
  for (const f of files) if (f.ext === 'txt' && f.size <= MAX_DRILL_TEXT && byDir.has(f.dir)) byDir.get(f.dir)!.push(f)
  const boards = [...byDir]
    .flatMap(([dir, list]) => splitByStem(dir, list))
    .filter((b) => !(b.files.length === 1 && EAGLE_CAM.has(b.files[0].ext)))
    .sort((a, b) => a.dir.localeCompare(b.dir) || a.stem.localeCompare(b.stem))
  boardsCache.set(files, boards)
  return boards
}

export function boardLabel(board: GerberBoardSet) {
  return [board.dir.slice(board.dir.lastIndexOf('/') + 1), board.stem].filter(Boolean).join(' · ') || 'Board'
}
