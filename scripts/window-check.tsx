/**
 * End-to-end check of the plugin window without OpenCode: renders `DoomWindow`
 * in an in-memory OpenTUI renderer, waits for the engine, presses keys and
 * verifies that the panel actually changes.
 *
 *   bun run scripts/window-check.tsx
 */
import { RGBA } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"

import { DoomWindow } from "../src/window"

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
      ui={{ confirm: async () => true, toast: (options) => console.log(`[toast] ${options.message}`) }}
      options={{ sound: false, fps: 30 }}
    />
  ),
  setup.renderer,
)

function paintedCells(frame: string): number {
  return (frame.match(/▀/g) ?? []).length
}

function fingerprint(): string {
  const spans = JSON.stringify(setup.captureSpans())
  let hash = 0
  for (let index = 0; index < spans.length; index++) {
    hash = (hash * 31 + spans.charCodeAt(index)) | 0
  }
  return `${hash}:${spans.length}`
}

const deadline = Date.now() + 20_000
let frame = ""
while (Date.now() < deadline) {
  await setup.renderOnce()
  frame = setup.captureCharFrame()
  if (frame.includes("fps ·") && paintedCells(frame) >= 1000) break
  await new Promise((resolve) => setTimeout(resolve, 50))
}

console.log(frame)
console.log(`painted cells: ${paintedCells(frame)}`)

if (!frame.includes("fps ·")) {
  console.error("FAIL: the game never reached the running state")
  await setup.dispose()
  process.exit(1)
}
if (paintedCells(frame) < 1000) {
  console.error("FAIL: the frame buffer is (nearly) empty")
  await setup.dispose()
  process.exit(1)
}

// Walk forward for a moment: the view must change.
const before = fingerprint()
setup.mockInput.pressKey("w")
for (let index = 0; index < 40; index++) {
  await setup.renderOnce()
  await new Promise((resolve) => setTimeout(resolve, 50))
}
const after = fingerprint()
console.log(`frame fingerprint before: ${before}, after: ${after}`)
setup.mockInput.pressKey("d")

const changed = after !== before

await setup.dispose()
if (!changed) {
  console.error("FAIL: the game ignored input")
  process.exit(1)
}
console.log("OK")
