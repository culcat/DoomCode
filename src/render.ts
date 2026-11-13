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

/**
 * Quadrant glyph for every 2x2 pixel pattern, indexed by bit mask:
 * bit 0 = top-left, 1 = top-right, 2 = bottom-left, 3 = bottom-right.
 * Set bits use the foreground colour.
 */
export const QUADRANTS = [
  " ",
  "▘",
  "▝",
  "▀",
  "▖",
  "▌",
  "▞",
  "▛",
  "▗",
  "▚",
  "▐",
  "▜",
  "▄",
  "▙",
  "▟",
  "█",
] as const
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

/** One representative sample for a small source rectangle (its centre). */
function centre(sample: Sampler, x0: number, y0: number, x1: number, y1: number): number {
  return sample(Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2))
}

function distance(a: number, b: number): number {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff)
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff)
  const db = (a & 0xff) - (b & 0xff)
  return dr * dr + dg * dg + db * db
}

/**
 * Renders 2x2 source pixels per cell with quadrant block glyphs.
 *
 * The terminal cell holds four pixels instead of two, so the picture is twice
 * as detailed in both axes. Each cell can only show two colours, so the four
 * samples are split into the closest foreground/background pair and the glyph
 * is chosen from that split.
 */
export function renderQuadrants(sample: Sampler, options: RenderOptions, sink: CellSink): void {
  const { cols, rows } = options
  const crop = options.crop ?? { x: 0, y: 0, width: ENGINE_WIDTH, height: ENGINE_HEIGHT }

  const scaleX = crop.width / (cols * 2)
  const scaleY = crop.height / (rows * 2)

  const x0s = new Int32Array(cols * 2)
  const x1s = new Int32Array(cols * 2)
  for (let px = 0; px < cols * 2; px++) {
    const start = crop.x + Math.floor(px * scaleX)
    x0s[px] = start
    x1s[px] = Math.min(crop.x + crop.width, Math.max(start + 1, Math.floor((px + 1) * scaleX)))
  }

  const y0s = new Int32Array(rows * 2)
  const y1s = new Int32Array(rows * 2)
  for (let py = 0; py < rows * 2; py++) {
    const start = crop.y + Math.floor(py * scaleY)
    y0s[py] = start
    y1s[py] = Math.min(crop.y + crop.height, Math.max(start + 1, Math.floor((py + 1) * scaleY)))
  }

  const pixels = [0, 0, 0, 0]

  for (let y = 0; y < rows; y++) {
    const top = y * 2
    for (let x = 0; x < cols; x++) {
      const left = x * 2

      pixels[0] = centre(sample, x0s[left]!, y0s[top]!, x1s[left]!, y1s[top]!)
      pixels[1] = centre(sample, x0s[left + 1]!, y0s[top]!, x1s[left + 1]!, y1s[top]!)
      pixels[2] = centre(sample, x0s[left]!, y0s[top + 1]!, x1s[left]!, y1s[top + 1]!)
      pixels[3] = centre(sample, x0s[left + 1]!, y0s[top + 1]!, x1s[left + 1]!, y1s[top + 1]!)

      // The two most distant samples become the cell's colours.
      let bestA = 0
      let bestB = 1
      let bestDistance = -1
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          const current = distance(pixels[i]!, pixels[j]!)
          if (current > bestDistance) {
            bestDistance = current
            bestA = i
            bestB = j
          }
        }
      }

      const colorA = pixels[bestA]!
      const colorB = pixels[bestB]!

      let mask = 0
      for (let i = 0; i < 4; i++) {
        if (distance(pixels[i]!, colorA) <= distance(pixels[i]!, colorB)) mask |= 1 << i
      }

      if (mask === 0 || mask === 0b1111) {
        // One colour covers the cell: pick the averaged sample.
        const value = centre(sample, x0s[left]!, y0s[top]!, x1s[left + 1]!, y1s[top + 1]!)
        sink.setCell(x, y, mask === 0 ? " " : "█", value, value)
        continue
      }

      let fr = 0
      let fgc = 0
      let fb = 0
      let fgSamples = 0
      let br = 0
      let bgc = 0
      let bb = 0
      let bgSamples = 0

      for (let i = 0; i < 4; i++) {
        const value = pixels[i]!
        if (mask & (1 << i)) {
          fr += (value >> 16) & 0xff
          fgc += (value >> 8) & 0xff
          fb += value & 0xff
          fgSamples++
        } else {
          br += (value >> 16) & 0xff
          bgc += (value >> 8) & 0xff
          bb += value & 0xff
          bgSamples++
        }
      }

      const fgColor = ((Math.round(fr / fgSamples) << 16) | (Math.round(fgc / fgSamples) << 8) | Math.round(fb / fgSamples)) >>> 0
      const bgColor = ((Math.round(br / bgSamples) << 16) | (Math.round(bgc / bgSamples) << 8) | Math.round(bb / bgSamples)) >>> 0

      sink.setCell(x, y, QUADRANTS[mask] ?? " ", fgColor, bgColor)
    }
  }
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
