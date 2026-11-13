/**
 * End-to-end check of the plugin window without OpenCode: renders the real
 * `DoomWindow` in an in-memory OpenTUI renderer, waits for the engine, presses
 * keys and verifies that the panel reacts. Runs both presentation modes.
 *
 *   bun run window-check
 */
import { RGBA } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { readFileSync, rmSync } from "node:fs"

import type { RenderMode } from "../src/window"

const LOG = "/tmp/opencode-doom-window-check.log"
process.env.DOOMCODE_DEBUG = LOG

interface Result {
  mode: RenderMode
  ok: boolean
  detail: string
}

function paintedCells(frame: string): number {
  return (frame.match(/[▀▘▝▖▗▌▐▞▚▛▜▙▟▄█]/g) ?? []).length
}

function debugLog(): string {
  try {
    return readFileSync(LOG, "utf8")
  } catch {
    return ""
  }
}

async function check(mode: RenderMode): Promise<Result> {
  rmSync(LOG, { force: true })
  const { DoomWindow } = await import("../src/window")

  const setup = await createTestRenderer({ width: 100, height: 44 })
  const theme = {
    border: { base: RGBA.fromInts(90, 90, 90) },
    text: { base: RGBA.fromInts(225, 225, 225), muted: RGBA.fromInts(140, 140, 140) },
  }

  await render(
    () => (
      <DoomWindow
        renderer={setup.renderer}
        panel={{ name: "doom.game", width: 96, focused: true, close: () => {} }}
        theme={theme}
        ui={{ confirm: async () => true, toast: () => {} }}
        options={{ sound: false, fps: 30, render: mode }}
      />
    ),
    setup.renderer,
  )

  const deadline = Date.now() + 20_000
  let frame = ""
  const needsCells = mode !== "image"
  while (Date.now() < deadline) {
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    const ready = frame.includes("fps ·") && (!needsCells || paintedCells(frame) >= 1000)
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  if (!frame.includes("fps ·")) {
    await setup.dispose()
    return { mode, ok: false, detail: "engine never reached the running state" }
  }

  const running = paintedCells(frame)
  if (running === 0) {
    console.log(`--- empty frame (${mode}) ---`)
    console.log(frame.split("\n").slice(1, 8).join("\n"))
  }
  const errors = debugLog().includes("session: boot failed")

  // Drive the player forward and confirm the panel reacts.
  const before = JSON.stringify(setup.captureSpans())
  setup.mockInput.pressKey("w")
  for (let index = 0; index < 40; index++) {
    await setup.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const after = JSON.stringify(setup.captureSpans())

  const log = debugLog()
  const imageMode = log.includes("render: image")

  await setup.dispose()

  if (errors) return { mode, ok: false, detail: "engine boot failed" }
  if (mode === "quadrant" || mode === "half") {
    if (running < 1000) return { mode, ok: false, detail: `only ${running} cells painted` }
    if (imageMode) return { mode, ok: false, detail: "expected the cell renderer" }
    if (before === after) return { mode, ok: false, detail: "frame did not change after input" }
  }
  if (mode === "image") {
    if (!imageMode) return { mode, ok: false, detail: "image renderer was not used" }
    if (!/protocol":\s*"(kitty|sixel|blocks)"/.test(log)) {
      return { mode, ok: false, detail: "image protocol was not resolved" }
    }
  }

  return { mode, ok: true, detail: imageMode ? "image renderer active" : `${running} cells painted` }
}

const results: Result[] = []
for (const mode of ["quadrant", "half", "image"] as const) {
  results.push(await check(mode))
}

for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.mode}: ${result.detail}`)
}

if (results.some((result) => !result.ok)) process.exit(1)
console.log("OK")
