/**
 * Headless rendering check for the plugin's window: mounts a
 * `FrameBufferRenderable` inside a Solid tree and captures the resulting cells.
 *
 *   bun run scripts/render-check.tsx
 */
import { FrameBufferRenderable, RGBA, type CliRenderer } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"

const COLS = 24
const ROWS = 8

function Canvas(props: { renderer: CliRenderer; onReady: (fb: FrameBufferRenderable) => void }) {
  return (
    <box
      ref={(element) => {
        if (!element) return
        const framebuffer = new FrameBufferRenderable(props.renderer, {
          width: COLS,
          height: ROWS,
        })
        element.add(framebuffer)
        props.onReady(framebuffer)
      }}
    />
  )
}

const setup = await createTestRenderer({ width: COLS + 4, height: ROWS + 4 })
let captured: FrameBufferRenderable | undefined

await render(
  () => (
    <box width={COLS + 2} height={ROWS + 2} border title="DOOM">
      <Canvas renderer={setup.renderer} onReady={(fb) => (captured = fb)} />
    </box>
  ),
  setup.renderer,
)
await setup.renderOnce()

if (!captured) throw new Error("FrameBufferRenderable was not mounted")

for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    const fg = RGBA.fromInts(255, (x * 255) / COLS, 0)
    const bg = RGBA.fromInts(0, 0, (y * 255) / ROWS)
    captured.frameBuffer.setCell(x, y, "▀", fg, bg)
  }
}
captured.requestRender()
await setup.renderOnce()
await setup.waitForVisualIdle()

console.log(setup.captureCharFrame())
await setup.dispose()
