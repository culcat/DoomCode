/** Dev helper: compares half-block and quadrant cell rendering at panel size. */
import { deflateSync } from "node:zlib"
import { Doom } from "../src/engine"
import { resolveWad } from "../src/paths"

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 6, 0, 0, 0], 8)
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const png = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.length
  }
  return png
}

const COLS = 74
const ROWS = 23
const SCALE = 5

const wad = resolveWad()
if (!wad) throw new Error("no wad")
const engine = await Doom.create({ wad: wad.path, warp: true, sound: false, onPrint: () => {} })
for (let frame = 0; frame < 120; frame++) engine.tick()
const sample = engine.sampler()

function sampleRect(x0: number, y0: number, x1: number, y1: number): number {
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const value = sample(x, y)
      r += (value >> 16) & 0xff
      g += (value >> 8) & 0xff
      b += value & 0xff
      count++
    }
  }
  return ((Math.round(r / count) << 16) | (Math.round(g / count) << 8) | Math.round(b / count)) >>> 0
}

function dump(name: string, pixels: number[], width: number, height: number) {
  const out = new Uint8Array(width * SCALE * height * SCALE * 4)
  for (let y = 0; y < height * SCALE; y++) {
    for (let x = 0; x < width * SCALE; x++) {
      const value = pixels[Math.floor(y / SCALE) * width + Math.floor(x / SCALE)] ?? 0
      const i = (y * width * SCALE + x) * 4
      out[i] = (value >> 16) & 0xff
      out[i + 1] = (value >> 8) & 0xff
      out[i + 2] = value & 0xff
      out[i + 3] = 255
    }
  }
  Bun.write(`/tmp/${name}.png`, encodePng(width * SCALE, height * SCALE, out))
}

// half block: 2 pixels per cell vertically
const half: number[] = []
for (let y = 0; y < ROWS * 2; y++) {
  const y0 = Math.floor(y * (800 / (ROWS * 2)))
  const y1 = Math.max(y0 + 1, Math.floor((y + 1) * (800 / (ROWS * 2))))
  for (let x = 0; x < COLS; x++) {
    const x0 = Math.floor(x * (1280 / COLS))
    const x1 = Math.max(x0 + 1, Math.floor((x + 1) * (1280 / COLS)))
    half.push(sampleRect(x0, y0, x1, y1))
  }
}
dump("compare-half", half, COLS, ROWS * 2)

// quadrant: 2x2 pixels per cell
const quad: number[] = []
for (let y = 0; y < ROWS * 2; y++) {
  const y0 = Math.floor(y * (800 / (ROWS * 2)))
  const y1 = Math.max(y0 + 1, Math.floor((y + 1) * (800 / (ROWS * 2))))
  for (let x = 0; x < COLS * 2; x++) {
    const x0 = Math.floor(x * (1280 / (COLS * 2)))
    const x1 = Math.max(x0 + 1, Math.floor((x + 1) * (1280 / (COLS * 2))))
    quad.push(sampleRect(x0, y0, x1, y1))
  }
}
dump("compare-quad", quad, COLS * 2, ROWS * 2)
console.log("wrote /tmp/compare-half.png and /tmp/compare-quad.png")
