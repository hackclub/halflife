import { useEffect } from 'react'
import type { ViewerProps } from '../types'
import { useLoad } from '../core/useLoad'
import { formatBytes } from '../core/format'
import { isZip, openZip, type Archive } from '../core/archive'
import { Gate, Toolbar } from '../ui/parts'

interface Preview {
  name: string
  label: string
  url: string | null
}

interface DesignObject {
  relativePath?: string
  displayName?: string
}

const KIND: Record<string, string> = {
  f3d: 'Fusion 360 design',
  f3z: 'Fusion 360 archive',
  fsch: 'Fusion electronics schematic',
  fbrd: 'Fusion electronics board',
  flbr: 'Fusion electronics library',
}

async function previewOf(archive: Archive) {
  const images = archive.entries.filter((e) => /(^|\/)Previews\/[^/]+\.png$/i.test(e.name))
  const best = images.find((e) => /big\.png$/i.test(e.name)) ?? images.sort((a, b) => b.size - a.size)[0]
  return best ? URL.createObjectURL(new Blob([(await archive.read(best)) as BlobPart], { type: 'image/png' })) : null
}

async function innerPreview(bytes: Uint8Array) {
  try {
    return await previewOf(openZip(bytes.slice().buffer as ArrayBuffer))
  } catch {
    return null
  }
}

async function readJson(archive: Archive, name: string) {
  const entry = archive.entries.find((e) => e.name === name)
  if (!entry) return null
  try {
    return JSON.parse(new TextDecoder().decode(await archive.read(entry)))
  } catch {
    return null
  }
}

async function designNames(archive: Archive) {
  const description = await readJson(archive, 'DesignDescription.json')
  const objects: DesignObject[] = (description?.designDescription?.designGraphs ?? []).flatMap(
    (graph: { designObjects?: DesignObject[] }) => graph.designObjects ?? [],
  )
  const names = new Map(
    objects.flatMap((o) => (o.relativePath && o.displayName ? [[o.relativePath, o.displayName]] : [])),
  )
  const root: unknown = (await readJson(archive, 'Manifest.json'))?.root
  return { names, root }
}

export default function FusionViewer({ file, source }: ViewerProps) {
  const state = useLoad(
    async ({ signal }) => {
      const bytes = await source.read(file.path, { signal })
      if (!isZip(new Uint8Array(bytes))) throw new Error('This file is not a Fusion archive the browser can open.')
      const archive = openZip(bytes)
      const previews: Preview[] = []
      const designs = archive.entries.filter((e) => /\.f3d$/i.test(e.name))
      if (designs.length > 0) {
        const { names, root } = await designNames(archive)
        designs.sort((a, b) => Number(b.name === root) - Number(a.name === root))
        for (const entry of designs.slice(0, 24)) {
          const inner = await archive.read(entry)
          previews.push({
            name: entry.name,
            label: names.get(entry.name) ?? entry.name,
            url: isZip(inner) ? await innerPreview(inner) : null,
          })
        }
      } else {
        previews.push({ name: file.name, label: file.name, url: await previewOf(archive) })
      }
      return previews
    },
    [source.id, file.path],
  )

  useEffect(() => {
    if (state.status !== 'ready') return
    const previews = state.value
    return () => previews.forEach((p) => p.url && URL.revokeObjectURL(p.url))
  }, [state])

  return (
    <div className="hurt-fusion">
      <Toolbar title={file.name} meta={`${KIND[file.ext] ?? 'Fusion file'} · ${formatBytes(file.size)}`} />
      <p className="hurt-note">
        Fusion stores geometry in a closed format that only Fusion can open. These are the preview images Fusion saved
        inside the file. Ask for a STEP export to inspect the geometry.
      </p>
      <Gate state={state}>
        {(previews) => (
          <div className="hurt-fusion__grid">
            {previews.map((p) => (
              <figure key={p.name} className="hurt-fusion__item">
                {p.url ? (
                  <img src={p.url} alt={`Preview of ${p.label}`} />
                ) : (
                  <div className="hurt-fusion__none">No preview saved</div>
                )}
                <figcaption>{p.label}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </Gate>
    </div>
  )
}
