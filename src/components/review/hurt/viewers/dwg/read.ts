import { Acis } from '../acis/acis'
import { Sab, SabError } from '../acis/sab'
import { StepWriter } from '../brep/step'
import { dwgPreview } from '../cadinfo'
import type { ParasolidModel, ParasolidShape } from '../parasolid/read'
import { asmRecords } from './acds'
import { DwgError, DwgFile } from './file'
import { compose, DwgObjects } from './objects'

const DATA_STORE = 'AcDb:AcDsPrototype_1b'

function solids(file: DwgFile, name: string, warnings: Set<string>) {
  const store = file.section(DATA_STORE)
  const records = store ? asmRecords(store) : []
  if (records.length === 0) return []
  const placements = new DwgObjects(file).solidPlacements()
  const out: ParasolidShape[] = []
  let [missing, unread] = [0, 0]
  for (const { handle, sab: bytes } of records) {
    const instances = placements.get(handle)
    if (!instances) continue
    try {
      const sab = new Sab(bytes)
      const acis = new Acis(sab)
      const bodies = acis.bodies()
      missing += acis.missing.curves + acis.missing.surfaces
      for (const placement of instances)
        for (const body of bodies) {
          const writer = new StepWriter(sab.millimetres)
          const transform = body.transform ? compose(placement, body.transform) : placement
          const items = writer.body({ ...body, transform })
          if (items.length === 0) continue
          const all = body.lumps.flatMap((lump) => lump.shells.flat())
          out.push({
            name: `Solid${out.length + 1}`,
            step: writer.write(name, items),
            faces: all.length,
            splines: all.filter((face) => face.surface?.type === 'spline').length,
            colour: null,
            faceColours: [],
          })
        }
    } catch (error) {
      if (!(error instanceof SabError)) throw error
      unread++
    }
  }
  if (unread > 0) warnings.add(`${unread} solids in this drawing could not be read and are missing.`)
  if (missing > 0)
    warnings.add(`${missing} curves or surfaces use geometry this viewer can't rebuild, so some faces are missing.`)
  return out
}

export async function readDwg(bytes: Uint8Array, name: string): Promise<ParasolidModel> {
  const warnings = new Set<string>()
  const thumbnail = dwgPreview(bytes)
  const preview = thumbnail ? new Uint8Array(await thumbnail.arrayBuffer()) : null
  let shapes: ParasolidShape[] = []
  try {
    shapes = solids(new DwgFile(bytes), name, warnings)
  } catch (error) {
    if (!(error instanceof DwgError)) throw error
    warnings.add(error.message)
  }
  if (shapes.length === 0 && warnings.size === 0)
    warnings.add(
      "This drawing has no 3D solids the viewer can read. 2D linework isn't drawn, and solids are only read from AutoCAD 2013 or newer drawings.",
    )
  return { shapes, preview, up: 'z', warnings: [...warnings] }
}
