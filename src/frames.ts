/**
 * Frame preparation for pixel rendering (Kitty graphics / Sixel).
 *
 * The engine renders 1280x800 ARGB. A terminal panel is roughly 640x400
 * physical pixels, so frames are box-downsampled once per frame into a reusable
 * RGBA buffer and handed to a `NativeImagePool`.
 */
import { ENGINE_HEIGHT, ENGINE_WIDTH } from "./paths"

/** Source pixels contributed to one destination pixel: at most 3x3 samples. */
function step(size: number): number {
  return Math.max(1, Math.floor(size / 3))
}

export class FrameDownscaler {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8Array
  #packed: Uint32Array

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.pixels = new Uint8Array(width * height * 4)
    this.#packed = new Uint32Array(this.pixels.buffer)
  }

  /** Converts and downscales one ARGB frame. Returns the RGBA buffer (reused). */
  update(source: Uint8Array): Uint8Array {
    const pixels = new Uint32Array(source.buffer, source.byteOffset, (source.byteLength / 4) | 0)
    const out = this.#packed
    const scaleX = ENGINE_WIDTH / this.width
    const scaleY = ENGINE_HEIGHT / this.height

    let index = 0
    for (let y = 0; y < this.height; y++) {
      const y0 = Math.floor(y * scaleY)
      const y1 = Math.min(ENGINE_HEIGHT, Math.max(y0 + 1, Math.floor((y + 1) * scaleY)))
      const stepY = step(y1 - y0)

      for (let x = 0; x < this.width; x++) {
        const x0 = Math.floor(x * scaleX)
        const x1 = Math.min(ENGINE_WIDTH, Math.max(x0 + 1, Math.floor((x + 1) * scaleX)))
        const stepX = step(x1 - x0)

        let r = 0
        let g = 0
        let b = 0
        let count = 0

        for (let sy = y0; sy < y1; sy += stepY) {
          const row = sy * ENGINE_WIDTH
          for (let sx = x0; sx < x1; sx += stepX) {
            const value = pixels[row + sx] ?? 0
            r += (value >> 16) & 0xff
            g += (value >> 8) & 0xff
            b += value & 0xff
            count++
          }
        }

        // RGBA bytes: little-endian word is AABBGGRR.
        out[index++] = 0xff000000 | (((b / count) | 0) << 16) | (((g / count) | 0) << 8) | ((r / count) | 0)
      }
    }

    return this.pixels
  }
}
