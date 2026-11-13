/** Debug helper: dumps frames as PNG (hand-rolled encoder, dev only). */
import { deflateSync } from "node:zlib"
import { Doom } from "../src/engine"
import { resolveWad } from "../src/paths"

let crcTable: number[] | undefined
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      return c >>> 0
    })
  }
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
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

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const parts = [signature, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const png = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.length
  }
  return png
}

const wad = resolveWad()
if (!wad) throw new Error("no wad")
const engine = await Doom.create({ wad: wad.path, warp: true, onPrint: () => {} })

const width = 640
const height = 400
const frames = [2, 30, 90, 240]
let tick = 0
for (const target of frames) {
  while (tick < target) {
    engine.tick()
    tick++
  }
  const rgba = new Uint8Array(width * height * 4)
  const sampler = engine.sampler()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = sampler(Math.floor((x * 1280) / width), Math.floor((y * 800) / height))
      const i = (y * width + x) * 4
      rgba[i] = (value >> 16) & 0xff
      rgba[i + 1] = (value >> 8) & 0xff
      rgba[i + 2] = value & 0xff
      rgba[i + 3] = 255
    }
  }
  await Bun.write(`/tmp/doom-frame-${target}.png`, encodePng(width, height, rgba))
  console.log(`wrote /tmp/doom-frame-${target}.png`)
}