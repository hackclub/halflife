import { serveWorker } from '../../core/workers'
import { readPsd, type Flattened } from './psd'
import { readXcf } from './xcf'

export interface RasterResult {
  blob: Blob
  note: string | null
}

const MAX_PIXELS = 24_000_000

async function encode(image: Flattened): Promise<RasterResult> {
  const notes = image.note ? [image.note] : []
  if (!image.rgba) {
    if (!image.thumbnail) throw new Error(image.note ?? 'This image has no flattened picture to show.')
    return { blob: new Blob([image.thumbnail as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), note: image.note }
  }
  if (image.outWidth < image.width)
    notes.push(
      `Shown at ${Math.round((image.outWidth / image.width) * 100)}% of its ${image.width} × ${image.height} px size.`,
    )
  const canvas = new OffscreenCanvas(image.outWidth, image.outHeight)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The browser could not draw this image.')
  context.putImageData(new ImageData(image.rgba, image.outWidth, image.outHeight), 0, 0)
  return { blob: await canvas.convertToBlob({ type: 'image/png' }), note: notes.join(' ') || null }
}

async function decode(read: () => Promise<Flattened>) {
  try {
    return { result: await encode(await read()) }
  } catch (error) {
    if (error instanceof RangeError) throw new Error('This file is damaged or cut short.')
    throw error
  }
}

serveWorker({
  psd: (payload) => decode(() => readPsd(payload.bytes as ArrayBuffer, MAX_PIXELS)),
  xcf: (payload) => decode(() => readXcf(payload.bytes as ArrayBuffer, MAX_PIXELS)),
})
