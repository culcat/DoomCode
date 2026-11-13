/**
 * Converts the DOOM frame buffer into terminal cells.
 *
 * One cell holds two vertical pixels: the upper half block `▀` paints its
 * foreground with the top pixel and its background with the bottom pixel,
 * which doubles the effective vertical resolution.
 *
 * Colours are plain `0xRRGGBB` numbers so this module stays free of renderer
 * imports and can be benchmarked headlessly.
 */
export interface CellSink {
  setCell(x: number, y: number, char: string, fg: number, bg: number): void
}

/** Reads one source pixel as `0xRRGGBB`. */
export type Sampler = (x: number, y: number) => number

export interface RenderOptions {
  cols: number
  rows: number
  /** Source rectangle in engine pixels; defaults to the whole 4:3 frame. */
  crop?: { x: number; y: number; width: number; height: number }
}

export const HALF_BLOCK = "▀"
export const ENGINE_WIDTH = 1280
export const ENGINE_HEIGHT = 800

/** Keeps a rectangle's contribution to at most 3x3 samples. */
function sampleStep(size: number): number {
  return Math.max(1, Math.floor(size / 3))
}

function averageRect(sample: Sampler, x0: number, y0: number, x1: number, y1: number): number {
  const width = Math.max(1, x1 - x0)
  const height = Math.max(1, y1 - y0)
  const stepX = sampleStep(width)
  const stepY = sampleStep(height)

  let r = 0
  let g = 0
  let b = 0
  let count = 0

  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const value = sample(x, y)
      r += (value >> 16) & 0xff
      g += (value >> 8) & 0xff
      b += value & 0xff
      count++
    }
  }

  if (count === 0) return 0
  return ((Math.round(r / count) << 16) | (Math.round(g / count) << 8) | Math.round(b / count)) >>> 0
}

export function renderHalfBlock(sample: Sampler, options: RenderOptions, sink: CellSink): void {
  const { cols, rows } = options
  const crop = options.crop ?? { x: 0, y: 0, width: ENGINE_WIDTH, height: ENGINE_HEIGHT }

  const scaleX = crop.width / cols
  const scaleY = crop.height / (rows * 2)

  for (let y = 0; y < rows; y++) {
    const topStart = crop.y + Math.floor(y * 2 * scaleY)
    const topEnd = Math.min(crop.y + crop.height, crop.y + Math.max(topStart + 1, Math.floor((y * 2 + 1) * scaleY)))
    const bottomStart = crop.y + Math.floor((y * 2 + 1) * scaleY)
    const bottomEnd = Math.min(crop.y + crop.height, crop.y + Math.max(bottomStart + 1, Math.floor((y * 2 + 2) * scaleY)))

    for (let x = 0; x < cols; x++) {
      const left = crop.x + Math.floor(x * scaleX)
      const right = Math.min(crop.x + crop.width, crop.x + Math.max(left + 1, Math.floor((x + 1) * scaleX)))

      const fg = averageRect(sample, left, topStart, right, topEnd)
      const bg = averageRect(sample, left, bottomStart, right, bottomEnd)
      sink.setCell(x, y, HALF_BLOCK, fg, bg)
    }
  }
}

/**
 * Source rectangle that centres the engine's 16:10 frame inside a
 * `cols x rows*2` window. Terminal cells are roughly twice as tall as wide, so
 * `rows * 2` is the pixel height of the window.
 */
export function aspectCrop(cols: number, rows: number): { x: number; y: number; width: number; height: number } {
  const frameAspect = ENGINE_WIDTH / ENGINE_HEIGHT
  const windowAspect = cols / (rows * 2)

  if (windowAspect > frameAspect) {
    const width = Math.round(ENGINE_HEIGHT * windowAspect)
    return { x: Math.round((ENGINE_WIDTH - width) / 2), y: 0, width, height: ENGINE_HEIGHT }
  }

  const height = Math.round(ENGINE_WIDTH / windowAspect)
  return { x: 0, y: Math.round((ENGINE_HEIGHT - height) / 2), width: ENGINE_WIDTH, height }
}

/** Rough luminance preview used by the smoke test to prove frames are not blank. */
export function preview(sample: Sampler, cols = 64, rows = 16): string {
  const shades = " .:-=+*#%@"
  const lines: string[] = []
  for (let y = 0; y < rows; y++) {
    let line = ""
    for (let x = 0; x < cols; x++) {
      const px = Math.floor((x * ENGINE_WIDTH) / cols)
      const py = Math.floor((y * ENGINE_HEIGHT) / rows)
      const value = sample(px, py)
      const luma =
        (((value >> 16) & 0xff) * 0.299 + ((value >> 8) & 0xff) * 0.587 + (value & 0xff) * 0.114) / 255
      line += shades[Math.min(shades.length - 1, Math.floor(luma * shades.length))] ?? " "
    }
    lines.push(line)
  }
  return lines.join("\n")
}
