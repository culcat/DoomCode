#!/usr/bin/env bun
/**
 * Headless engine benchmark: boots DOOM, runs `--frames` ticks and measures the
 * cost of a tick plus a half-block render pass. No terminal required.
 *
 *   bun run smoke                 # 180 frames, 96x36 window
 *   bun run smoke --frames 600 --cols 128 --rows 48
 */
import { Doom } from "../src/engine"
import { resolveWad } from "../src/paths"
import { preview, renderHalfBlock, type CellSink } from "../src/render"

const argv = Bun.argv.slice(2)
function flag(name: string, fallback: number): number {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(argv[index + 1])
  return Number.isFinite(value) ? value : fallback
}

const frames = flag("frames", 180)
const cols = flag("cols", 96)
const rows = flag("rows", 36)

const wad = resolveWad()
if (!wad) {
  console.error("no WAD found: run `bun run fetch-assets` or set DOOM_WAD")
  process.exit(1)
}

console.log(`wad: ${wad.path} (${wad.origin})`)
const started = performance.now()
const engine = await Doom.create({ wad: wad.path, warp: true, onPrint: () => {} })
console.log(`engine ready in ${(performance.now() - started).toFixed(0)} ms`)

let cells = 0
let checksum = 0
const sink: CellSink = {
  setCell(_x, _y, _char, fg, bg) {
    cells++
    checksum = (checksum + fg + bg) % 0xffffffff
  },
}

const tickTimes: number[] = []
const renderTimes: number[] = []

for (let frame = 0; frame < frames; frame++) {
  const tickStart = performance.now()
  engine.tick()
  tickTimes.push(performance.now() - tickStart)

  if (frame % 2 === 0) {
    const renderStart = performance.now()
    renderHalfBlock(engine.sampler(), { cols, rows }, sink)
    renderTimes.push(performance.now() - renderStart)
  }
}

function summarize(label: string, values: number[]): string {
  const sorted = [...values].sort((a, b) => a - b)
  const avg = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
  return `${label}: avg ${avg.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`
}

const avgTick = tickTimes.reduce((a, b) => a + b, 0) / Math.max(1, tickTimes.length)
const avgRender = renderTimes.reduce((a, b) => a + b, 0) / Math.max(1, renderTimes.length)

console.log(summarize("tick", tickTimes))
console.log(summarize("render", renderTimes))
console.log(`cells/frame: ${(cells / Math.max(1, renderTimes.length)).toFixed(0)}`)
console.log(`checksum: ${checksum}`)
console.log(`theoretical fps: ${(1000 / (avgTick + avgRender)).toFixed(1)}`)
console.log(preview(engine.sampler()))
