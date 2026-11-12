import type { FileKind, HurtFile } from '../types'
import { gerberBoards } from '../viewers/gerber/sets'

const KINDS: Record<string, FileKind> = {}

function register(kind: FileKind, extensions: string) {
  for (const ext of extensions.split(/\s+/).filter(Boolean)) KINDS[ext] = kind
}

register(
  'model',
  'step stp iges igs brep brp fcstd fcbak fcstd1 f3d f3z x_t x_b xmt_txt xmt_bin stl obj ply 3mf gltf glb dae fbx amf wrl vrml 3ds vtk vtp usdz usdc usda usd pcb3d blend blend1 dwg',
)
register('kicad', 'kicad_sch kicad_pcb kicad_pro')
register('easyeda', 'epro esch epcb eproproject epro2 eprj efoo esym elibz')
register('eagle', 'brd sch lbr')
register('altium', 'schdoc pcbdoc prjpcb')
register('fritzing', 'fzz fzpz')
register('librepcb', 'lpp lppz lp')
register(
  'gerber',
  'gbr ger gtl gbl gts gbs gto gbo gtp gbp gko gml gm gm1 gm2 gm3 gm4 gm13 gp1 gp2 g1 g2 g3 g4 pho art cmp sol stc sts plc pls crc crs drl xln exc gta gba gdl gdd',
)
register('dxf', 'dxf')
register('pdf', 'pdf ai')
register('image', 'png jpg jpeg gif webp bmp ico avif apng svg psd psb xcf kra kra~ ora')
register('video', 'mp4 webm mov m4v ogv mkv')
register('audio', 'mp3 wav ogg oga flac m4a')
register('markdown', 'md markdown mdx')
register('table', 'csv tsv xlsx xlsm xls ods')
register('archive', 'zip tar tgz gz rar 7z txz tbz2 xz bz2')
register('document', 'docx docm dotx pptx')
register('fusion', 'fsch fbrd flbr')
register('cadsource', 'sldprt sldasm slddrw ipt iam idw ipn')
register('html', 'html htm xhtml')
register(
  'text',
  `txt text log json jsonc json5 yaml yml toml ini cfg conf config properties env xml css scss sass less
   js mjs cjs jsx ts tsx vue svelte py pyw pyi ino pde c h cc cpp cxx hh hpp hxx s asm inc ld rs go zig java kt kts
   cs swift dart lua rb php pl r m jl ex exs erl hs ml fs clj scala groovy gradle sh bash zsh fish ps1 bat cmd
   sql graphql gql proto diff patch v sv svh vh vhd vhdl tcl xdc ucf pcf qsf sdc cmake mk makefile dockerfile
   keymap overlay dts dtsi defconfig kconfig board rst adoc tex bib
   kicad_sym kicad_mod kicad_prl kicad_dru kicad_sch-bak kicad_pcb-bak dcm lib pro net cir sp spice asc
   ipc d356 rpt pos gbrjob drc erc bom scad jscad xt gcode nc ngc tap gc kicad_wks scr
   lck lock bak ioc cad dsn ses d su mtl map lst x icf cyclo defaults shield sysbuild example sample in service rules
   mod sum code-workspace vil hjson ipynb excalidraw drawio iml uvprojx uvoptx ewp eww xpr launch inf url ahk nix
   hbs pio lpf prefs version check_cache round-tracks-config sat 356a eep bip ptf epl dsl cpa ftf foota edf pdif
   plx upfx plist storyboard xib pbxproj xcworkspacedata xcscheme xcsettings xcconfig entitlements projbuild rc
   manifest webmanifest ninja make xslt bdf prjpcbstructure outjob`,
)

const TEXT_NAMES = new Set([
  'makefile',
  'dockerfile',
  'license',
  'licence',
  'readme',
  'changelog',
  'kconfig',
  'cmakelists.txt',
  'procfile',
  'gemfile',
  'rakefile',
  '.gitignore',
  '.gitattributes',
  '.gitmodules',
  '.editorconfig',
  '.clang-format',
])

const RISKY = new Set('exe dll msi bat cmd com pif ps1 vbs vbe wsf hta jar lnk apk dmg iso reg msc cpl scr'.split(' '))

function extensionOf(name: string) {
  const lower = name.toLowerCase()
  if (lower.endsWith('.tar.gz')) return 'tgz'
  if (lower.endsWith('.tar.xz')) return 'txz'
  if (lower.endsWith('.tar.bz2')) return 'tbz2'
  const dot = lower.lastIndexOf('.')
  return dot > 0 ? lower.slice(dot + 1) : ''
}

const COMPILED_OBJECT = /\.(c|cc|cpp|cxx|s|asm)\.obj$/i

function kindOf(name: string, ext = extensionOf(name)): FileKind {
  if (COMPILED_OBJECT.test(name) || name.startsWith('._')) return 'binary'
  if (KINDS[ext]) return KINDS[ext]
  if (TEXT_NAMES.has(name.toLowerCase())) return 'text'
  return 'binary'
}

export function makeFile(path: string, size: number, submodule = false): HurtFile {
  const slash = path.lastIndexOf('/')
  const name = slash >= 0 ? path.slice(slash + 1) : path
  const ext = extensionOf(name)
  return {
    path,
    name,
    dir: slash >= 0 ? path.slice(0, slash) : '',
    ext,
    size,
    kind: submodule ? 'submodule' : kindOf(name, ext),
    risky: RISKY.has(ext),
  }
}

const LIBRARY_PATH =
  /(^|\/)([^/]+\.(pretty|3dshapes)|libraries|node_modules|\.git|[^/]*-?backups?|[^/]+\.lplib|library\/(sym|pkg|cmp|dev|cat|pkgcat)|__pycache__|CMakeFiles|\.pio(envs)?|\.build|\.esphome|qmk_firmware|kmk_firmware[^/]*|kmk\/boards|chibios(-contrib)?|adafruit-circuitpython-[^/]*)(\/|$)/i
const GERBER_ZIP = /gerber|fab|manufactur|production|jlc|pcbway|(^|[^a-z])cam([^a-z]|$)/i
const NOT_GERBER_ZIP = /odb|stl|step|stp|3mf|firmware|kmk|qmk|pnp|\.pos/i

const BACKUP_EXTENSIONS = new Set(['fcbak', 'fcstd1', 'blend1'])
const OLD_VERSIONS = /(^|\/)OldVersions\//

export function isLibraryPath(path: string) {
  return LIBRARY_PATH.test(path)
}

export function isBackup(file: HurtFile) {
  return BACKUP_EXTENSIONS.has(file.ext) || OLD_VERSIONS.test(file.path) || file.name.startsWith('_autosave-')
}

function isGerberArchive(file: HurtFile) {
  return (
    file.kind === 'archive' &&
    ['zip', 'rar', '7z', 'tgz'].includes(file.ext) &&
    !file.name.startsWith('._') &&
    GERBER_ZIP.test(file.path) &&
    (/gerber/i.test(file.name) || !NOT_GERBER_ZIP.test(file.name))
  )
}

export interface PinEntry {
  file: HurtFile
  label?: string
  hidden?: boolean
}

export interface PinGroup {
  title: string
  files: PinEntry[]
}

const README = /^readme(\.|$)/i
const JOURNAL = /^journal(\.|$)/i
const BOM = /bom|bill[ _-]?of[ _-]?materials/i
const FIRMWARE = /(^|\/)(main\.(c|cpp|py|rs)|code\.py|boot\.py|kb\.py|keymap\.(c|json)|[^/]+\.ino|[^/]+\.keymap)$/i
const FIRMWARE_CONFIG = /(^|\/)(keyboard\.json|platformio\.ini)$/i
const FIRMWARE_IMAGE = /\.(uf2|hex)$/i
const FIRMWARE_DIR = /(^|\/)(firmware|software|fw)(\/|$)|^(src|code)(\/|$)/i
const PIN_LIMIT = 12

const BOM_PAGE = /(^|[^a-z])i?bom([^a-z]|$)|interactive|bill[ _-]?of[ _-]?materials/i

const sniffedPages = new WeakMap<HurtFile, boolean>()
let sniffedVersion = 0

export function isBomPage(f: HurtFile) {
  return f.kind === 'ibom' || (f.kind === 'html' && sniffedPages.get(f) === true)
}

export function namedLikeBomPage(f: HurtFile) {
  return BOM_PAGE.test(f.name)
}

export function pageSniffed(f: HurtFile) {
  return sniffedPages.has(f)
}

export function noteBomPage(f: HurtFile, bom: boolean) {
  if (f.kind !== 'html' || sniffedPages.get(f) === bom) return false
  sniffedPages.set(f, bom)
  sniffedVersion++
  return true
}

export function bomPagesVersion() {
  return sniffedVersion
}

export function pinnedGroups(files: HurtFile[]): PinGroup[] {
  const usable = files.filter((f) => !isLibraryPath(f.path))
  const byDepth = (a: HurtFile, b: HurtFile) =>
    a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path)
  const topLevel = (list: HurtFile[]) => {
    const sorted = [...list].sort(byDepth)
    const depth = sorted[0]?.path.split('/').length
    return sorted.map((file) => ({ file, hidden: file.path.split('/').length !== depth }))
  }

  const gerberSets = gerberBoards(usable).map(({ dir, stem, files: set }) => ({
    dir: stem ? `${dir ? `${dir}/` : ''}${stem}` : dir,
    list: set.filter((f) => f.kind === 'gerber').sort((a, b) => Number(a.dir !== dir) - Number(b.dir !== dir)),
  }))
  const pcb = usable
    .filter(
      (f) =>
        (f.kind === 'kicad' ||
          f.kind === 'easyeda' ||
          f.kind === 'eagle' ||
          f.kind === 'altium' ||
          f.kind === 'fritzing' ||
          (f.kind === 'librepcb' && f.ext !== 'lp')) &&
        !f.name.startsWith('_autosave-'),
    )
    .sort((a, b) => pcbRank(a) - pcbRank(b) || byDepth(a, b))

  const groups: PinGroup[] = [
    { title: 'Readme', files: topLevel(usable.filter((f) => f.kind === 'markdown' && README.test(f.name))) },
    { title: 'Journal', files: topLevel(usable.filter((f) => f.kind === 'markdown' && JOURNAL.test(f.name))) },
    {
      title: '3D',
      files: modelEntries(
        usable.filter(
          (f) =>
            (f.kind === 'model' && !isBackup(f)) ||
            f.kind === 'fusion' ||
            (f.kind === 'cadsource' && !/^(slddrw|idw|ipn)$/.test(f.ext) && !f.name.startsWith('~$') && !isBackup(f)),
        ),
        pcb,
      ),
    },
    { title: 'PCB', files: pcb.map((file) => ({ file, hidden: pcbDependency(file, pcb) })) },
    {
      title: 'Gerbers',
      files: [
        ...gerberSets.map(({ dir, list }) => ({
          file: list[0],
          label: `${dir || 'Repository root'} · ${list.length} ${list.length === 1 ? 'file' : 'files'}`,
        })),
        ...usable.filter(isGerberArchive).map((file) => ({ file })),
      ],
    },
    {
      title: 'Parts list',
      files: usable
        .filter((f) => (f.kind === 'table' && (BOM.test(f.path) || !f.dir)) || isBomPage(f))
        .sort((a, b) => Number(!BOM.test(a.path)) - Number(!BOM.test(b.path)) || byDepth(a, b))
        .map((file) => ({ file })),
    },
    {
      title: 'Drawings and documents',
      files: usable
        .filter(
          (f) =>
            f.kind === 'dxf' ||
            f.kind === 'pdf' ||
            (f.kind === 'document' && !f.name.startsWith('~$')) ||
            (f.kind === 'cadsource' && /^(slddrw|idw)$/.test(f.ext) && !f.name.startsWith('~$') && !isBackup(f)),
        )
        .sort(byDepth)
        .map((file) => ({ file })),
    },
    {
      title: 'Firmware',
      files: usable
        .filter((f) => firmwareRank(f) < Infinity)
        .sort((a, b) => firmwareRank(a) - firmwareRank(b) || byDepth(a, b))
        .map((file) => ({ file, hidden: firmwareRank(file) === 3 })),
    },
    {
      title: 'Executables',
      files: files
        .filter((f) => f.risky)
        .sort((a, b) => Number(isLibraryPath(a.path)) - Number(isLibraryPath(b.path)) || byDepth(a, b))
        .map((file) => ({ file })),
    },
  ]
  return groups.filter((g) => g.files.length > 0).map((g) => ({ ...g, files: limit(g.files) }))
}

function firmwareRank(f: HurtFile) {
  if (FIRMWARE.test(f.path)) return 0
  if (FIRMWARE_CONFIG.test(f.path)) return 1
  if (FIRMWARE_IMAGE.test(f.path)) return 2
  if (FIRMWARE_DIR.test(f.dir) && (f.kind === 'text' || (f.kind === 'binary' && !f.ext))) return 3
  return Infinity
}

function limit(entries: PinEntry[]) {
  const visible = entries.filter((e) => !e.hidden)
  const shown = visible.length > 0 ? visible : entries.slice(0, 1)
  const kept = new Set(shown.slice(0, PIN_LIMIT))
  return [...shown, ...entries.filter((e) => !shown.includes(e))].map((e) => ({ ...e, hidden: !kept.has(e) }))
}

const BREP = new Set(['step', 'stp', 'iges', 'igs', 'brep', 'brp'])
const ASSEMBLY_SOURCE = new Set(['fcstd', 'f3d', 'f3z', 'sldasm', 'iam'])
const SCENE = new Set(['blend'])
const PART_OF: Record<string, string> = { sldprt: 'sldasm', ipt: 'iam' }
const COPY = /\s*\(\d+\)$|[ _-]*copy$/i
const VERSION = /[ _-]*(v|ver|version|rev)[ _-]*(\d+)([._]\d+)*$/i
const ASSEMBLY_NAME = /assembl|(^|[^a-z])(asm|full|complete|whole)([^a-z]|$)/i
const COMPONENT_DIR = /3d|model|step|package|footprint|lib|component/i
const PART_RATIO = 4

function versionOf(file: HurtFile) {
  const stem = file.name.slice(0, file.name.length - file.ext.length - 1)
  const copy = COPY.test(stem)
  const base = stem.replace(COPY, '')
  const match = base.match(VERSION)
  const family = BREP.has(file.ext) ? 'brep' : file.ext
  return {
    key: `${file.dir}/${(match ? base.slice(0, match.index) : base).toLowerCase()}.${family}`,
    version: match ? Number(match[2]) : 0,
    copy,
  }
}

function modelEntries(models: HurtFile[], pcb: HurtFile[]): PinEntry[] {
  const versions = new Map(models.map((f) => [f, versionOf(f)]))
  const superseded = (f: HurtFile) => {
    const own = versions.get(f)!
    return models.some((g) => {
      const other = versions.get(g)!
      return (
        g !== f &&
        other.key === own.key &&
        (other.version > own.version || (other.version === own.version && own.copy && !other.copy))
      )
    })
  }
  const edaDirs = [...new Set(pcb.filter((f) => !pcbLibrary(f)).map((f) => f.dir))]
  const boardSide = (f: HurtFile) =>
    edaDirs.some((dir) =>
      dir ? f.dir === dir || f.dir.startsWith(`${dir}/`) : f.dir !== '' && COMPONENT_DIR.test(f.dir.split('/')[0]),
    )
  const tier = (f: HurtFile) => (solid(f) ? 0 : SCENE.has(f.ext) ? 1 : 2)
  const solid = (f: HurtFile) => BREP.has(f.ext) || ASSEMBLY_SOURCE.has(f.ext) || f.ext in PART_OF
  const current = models.filter((f) => !superseded(f))
  const assembled = current.some((f) => (BREP.has(f.ext) || ASSEMBLY_SOURCE.has(f.ext)) && !boardSide(f))
  const assemblies = current.filter((f) => BREP.has(f.ext) && ASSEMBLY_NAME.test(f.name) && !boardSide(f))
  const partOfNamed = (f: HurtFile) =>
    !assemblies.includes(f) &&
    assemblies.some((a) => f.dir === a.dir || f.dir.startsWith(`${a.dir}/`) || (a.dir === '' && !boardSide(f)))
  const largest = Math.max(
    0,
    ...current.filter((f) => BREP.has(f.ext) && !(assembled && boardSide(f)) && !partOfNamed(f)).map((f) => f.size),
  )
  const hidden = (f: HurtFile) =>
    superseded(f) ||
    (BREP.has(f.ext) && partOfNamed(f)) ||
    (assembled && (boardSide(f) || (!solid(f) && !SCENE.has(f.ext)))) ||
    (BREP.has(f.ext) && f.size * PART_RATIO < largest) ||
    (f.ext in PART_OF && models.some((g) => g.ext === PART_OF[f.ext]))
  return models
    .map((file) => ({ file, hidden: hidden(file) }))
    .sort((a, b) => tier(a.file) - tier(b.file) || b.file.size - a.file.size)
}

function pcbLibrary(f: HurtFile) {
  return PCB_RANK[f.ext] === 4 || f.ext === 'lbr'
}

function pcbDependency(file: HurtFile, pcb: HurtFile[]) {
  if (pcbLibrary(file)) return true
  if (file.ext === 'lppz') return pcb.some((f) => f.ext === 'lpp')
  if (file.ext !== 'kicad_sch') return false
  const roots = pcb
    .filter((f) => f.ext === 'kicad_pro' && f.dir === file.dir)
    .map((f) => `${f.name.slice(0, -'kicad_pro'.length)}kicad_sch`)
  return !roots.includes(file.name) && pcb.some((f) => f.dir === file.dir && roots.includes(f.name))
}

const PCB_RANK: Record<string, number> = {
  kicad_pro: 0,
  epro: 0,
  epro2: 0,
  eprj: 0,
  prjpcb: 0,
  lpp: 0,
  kicad_sch: 1,
  sch: 1,
  schdoc: 1,
  fzz: 1,
  kicad_pcb: 2,
  brd: 2,
  pcbdoc: 2,
  efoo: 4,
  esym: 4,
  elibz: 4,
  fzpz: 4,
}

const AMBIGUOUS_PCB_RANK = 5

function pcbRank(f: HurtFile) {
  return (f.kind === 'eagle' ? AMBIGUOUS_PCB_RANK : 0) + (PCB_RANK[f.ext] ?? 3)
}

export function defaultFile(files: HurtFile[]): HurtFile | undefined {
  return (
    pinnedGroups(files).find((g) => g.files.length > 0)?.files[0].file ??
    files.find((f) => f.kind !== 'binary' && f.kind !== 'submodule')
  )
}

export { looksLikeText } from './text'
