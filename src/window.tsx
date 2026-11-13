/**
 * The DOOM window itself. Kept free of plugin-context hooks so it can be
 * rendered by the host (`tui.tsx`) and by the headless harness
 * (`scripts/window-check.tsx`) with the same code path.
 *
 * Two presentations share one engine:
 * - `image`  — frames are downsampled to RGBA and drawn as a native image
 *              (Kitty graphics or Sixel), which keeps the panel's full pixel
 *              resolution. Used automatically when the terminal supports it.
 * - `cells`  — the portable fallback: two pixels per cell with the `▀` half
 *              block, which works in every terminal including tmux.
 */
import {
  FrameBufferRenderable,
  ImageRenderable,
  NativeImagePool,
  RGBA,
  type BoxRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core"
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { join } from "node:path"

import { dataDir, resolveWad } from "./paths"
import { isHostKey, toDoomKey } from "./keys"
import { GameSession, type SessionStatus } from "./session"
import type { Doom } from "./engine"
import { aspectCrop, renderHalfBlock, renderQuadrants, type CellSink } from "./render"
import { FrameDownscaler } from "./frames"
import { downloadWad } from "./wad"
import { debug } from "./debug"

/** Rendered image size; close to the physical pixels of a typical panel. */
const IMAGE_WIDTH = 640
const IMAGE_HEIGHT = 400

export type RenderMode = "auto" | "image" | "quadrant" | "half"

interface Presenter {
  sink?: CellSink
  present?: (engine: Doom) => void
}

export interface DoomOptions {
  /** Window width in cells. Defaults to 88, shrunk to fit the panel. */
  cols?: number
  /** Rows in cells; derived from `cols` (16:10) by default. */
  rows?: number
  fps?: number
  sound?: boolean
  wad?: string
  /** Presentation: native pixel images when available, or half-block cells. */
  render?: RenderMode
}

/** Panel state the window needs. Matches `PanelInput` from the plugin API. */
export interface WindowPanel {
  readonly name: string
  readonly width: number
  readonly focused: boolean
  readonly close: () => void
  readonly focus?: () => void
}

export interface WindowTheme {
  readonly border: { readonly base: RGBA }
  readonly text: { readonly base: RGBA; readonly muted: RGBA }
}

export interface WindowUi {
  confirm(options: { title: string; message: string; label: { confirm: string; cancel: string } }): Promise<boolean | undefined>
  toast(options: { message: string; variant?: "success" | "warning" | "error"; duration?: number }): void
}

export interface DoomWindowProps {
  renderer: CliRenderer
  panel: WindowPanel
  theme: WindowTheme
  ui: WindowUi
  options: DoomOptions
}

export function windowSize(panelWidth: number, options: DoomOptions): { cols: number; rows: number } {
  const available = Math.max(40, panelWidth - 6)
  const cols = Math.min(options.cols ?? 88, available)
  const rows = options.rows ?? Math.max(12, Math.round(cols * 0.3125))
  return { cols, rows }
}

function supportsImages(renderer: CliRenderer): boolean {
  const capabilities = renderer.capabilities
  return Boolean(capabilities?.kitty_graphics || capabilities?.sixel)
}

export type ResolvedRenderMode = "image" | "quadrant" | "half"

/**
 * `auto` prefers native pixels when the terminal can show images, and falls
 * back to quadrant cells (four pixels per cell) otherwise.
 */
export function resolveRenderMode(requested: RenderMode | undefined, renderer: CliRenderer): ResolvedRenderMode {
  if (requested === "image") return "image"
  if (requested === "quadrant") return "quadrant"
  if (requested === "half") return "half"
  return supportsImages(renderer) ? "image" : "quadrant"
}

export function DoomWindow(props: DoomWindowProps) {
  const [status, setStatus] = createSignal<SessionStatus>({ state: "loading", fps: 0 })
  const [dimensions, setDimensions] = createSignal(windowSize(props.panel.width, props.options))
  const [problem, setProblem] = createSignal<string>()

  let host: BoxRenderable | undefined
  let framebuffer: FrameBufferRenderable | undefined
  let image: ImageRenderable | undefined
  let pool: NativeImagePool | undefined
  let session: GameSession | undefined
  let detachKeys: (() => void) | undefined
  let cancelled = false

  createEffect(() => {
    const next = windowSize(props.panel.width, props.options)
    const previous = dimensions()
    if (next.cols === previous.cols && next.rows === previous.rows) return
    setDimensions(next)
    if (framebuffer) {
      framebuffer.width = next.cols
      framebuffer.height = next.rows
    }
    if (image) {
      image.width = next.cols
      image.height = next.rows
    }
  })

  function handlePress(key: KeyEvent): void {
    if (isHostKey(key)) return
    const code = toDoomKey(key)
    if (code === undefined) return
    key.preventDefault()
    key.stopPropagation()
    session?.key(code, true)
  }

  function handleRelease(key: KeyEvent): void {
    session?.noteReleaseEvents()
    const code = toDoomKey(key)
    if (code !== undefined) session?.key(code, false)
  }

  /**
   * OpenCode routes panel input through its own layer stack, so renderable
   * focus alone is not enough: while the panel is focused the game listens to
   * the renderer's key stream and claims the keys it understands.
   */
  function attachKeys(): void {
    if (detachKeys) return
    props.renderer.keyInput.on("keypress", handlePress)
    props.renderer.keyInput.on("keyrelease", handleRelease)
    detachKeys = () => {
      props.renderer.keyInput.off("keypress", handlePress)
      props.renderer.keyInput.off("keyrelease", handleRelease)
    }
  }

  createEffect(() => {
    const focused = props.panel.focused
    debug("panel: focused", focused)
    if (focused) {
      attachKeys()
      session?.resume()
      framebuffer?.focus()
    } else {
      detachKeys?.()
      detachKeys = undefined
      session?.pause()
    }
  })

  async function resolveWadWithPrompt() {
    const existing = resolveWad(props.options.wad)
    if (existing) return existing

    const confirmed = await props.ui.confirm({
      title: "DOOM assets",
      message:
        "DOOM1.WAD (shareware episode 1, ~4 MB) was not found.\nDownload it to ~/.local/share/opencode/doom?",
      label: { confirm: "Download", cancel: "Cancel" },
    })
    if (!confirmed) return undefined

    props.ui.toast({ message: "Downloading DOOM1.WAD…", duration: 5000 })
    try {
      await downloadWad(join(dataDir(), "doom1.wad"), () => {})
    } catch (error) {
      setProblem(`Download failed: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
    props.ui.toast({ message: "DOOM1.WAD ready", variant: "success" })
    return resolveWad(props.options.wad)
  }

  function createCellPresenter(cols: number, rows: number, variant: "quadrant" | "half"): Presenter {
    const fb = new FrameBufferRenderable(props.renderer, { id: "doom-framebuffer", width: cols, height: rows })
    fb.focusable = true
    framebuffer = fb
    host?.add(fb)
    fb.focus()

    const sink: CellSink = {
      setCell(x, y, char, fg, bg) {
        framebuffer?.frameBuffer.setCell(
          x,
          y,
          char,
          RGBA.fromInts((fg >> 16) & 0xff, (fg >> 8) & 0xff, fg & 0xff),
          RGBA.fromInts((bg >> 16) & 0xff, (bg >> 8) & 0xff, bg & 0xff),
        )
      },
    }

    const crop = aspectCrop(cols, rows)
    return {
      sink,
      present: (engine: Doom) => {
        const sample = engine.frameSampler() ?? engine.sampler()
        if (variant === "half") renderHalfBlock(sample, { cols, rows, crop }, sink)
        else renderQuadrants(sample, { cols, rows, crop }, sink)
      },
    }
  }

  function createImagePresenter(cols: number, rows: number, allowFallback: boolean): Presenter {
    const view = new ImageRenderable(props.renderer, {
      id: "doom-image",
      width: cols,
      height: rows,
      fit: "fill",
    })
    image = view

    const frames = new NativeImagePool({
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      capacity: 3,
      owner: props.renderer.nativeScene.resourceContext,
    })
    pool = frames
    const downscaler = new FrameDownscaler(IMAGE_WIDTH, IMAGE_HEIGHT)

    // `host` is assigned by the ref callback before `start` runs.
    host?.add(view)

    let reported = false
    let switched: Presenter | undefined

    function dropImage(): void {
      view.destroy()
      if (image === view) image = undefined
      frames.dispose()
      if (pool === frames) pool = undefined
    }

    return {
      present: (engine: Doom) => {
        if (switched) {
          switched.present?.(engine)
          return
        }

        const source = engine.frameView()
        if (!source) return
        const frame = frames.publishRgba(downscaler.update(source))
        if (!frame) return
        try {
          view.source = frame
        } finally {
          frame.dispose()
        }

        if (reported) return
        reported = true

        const protocol = view.effectiveProtocol
        debug("render: image", { protocol, width: IMAGE_WIDTH, height: IMAGE_HEIGHT })

        // A terminal without Kitty/Sixel support degrades to OpenTUI's own
        // block fallback, which is coarser than our quadrant renderer.
        if (allowFallback && protocol === "blocks") {
          debug("render: falling back to quadrant cells")
          dropImage()
          const fallback = createCellPresenter(cols, rows, "quadrant")
          switched = fallback
          fallback.present?.(engine)
        }
      },
    }
  }

  async function start(): Promise<void> {
    const capabilities = props.renderer.capabilities
    debug("window: start", {
      requested: props.options.render ?? "auto",
      resolved: resolveRenderMode(props.options.render, props.renderer),
      kitty: capabilities?.kitty_graphics,
      sixel: capabilities?.sixel,
      graphicsEnv: process.env.OPENTUI_GRAPHICS,
      protocolEnv: process.env.OPENTUI_IMAGE_PROTOCOL,
    })
    const wad = await resolveWadWithPrompt()
    debug("window: wad", wad?.path)
    if (cancelled) return
    if (!wad) {
      if (!problem()) setProblem("DOOM1.WAD is missing. Run /doom to download it.")
      return
    }

    const { cols, rows } = dimensions()
    const activeMode = resolveRenderMode(props.options.render, props.renderer)

    let presenter: Presenter | undefined
    if (activeMode === "image") {
      try {
        presenter = createImagePresenter(cols, rows, (props.options.render ?? "auto") === "auto")
      } catch (error) {
        debug("render: image failed, falling back to cells", error)
      }
    }
    if (!presenter) presenter = createCellPresenter(cols, rows, activeMode === "half" ? "half" : "quadrant")

    props.panel.focus?.()

    debug("window: creating session", { cols, rows, mode: activeMode })
    try {
      const created = await GameSession.create({
        wad: wad.path,
        cols,
        rows,
        fps: props.options.fps ?? 30,
        sound: props.options.sound ?? true,
        sink: presenter.sink,
        present: presenter.present,
        onFrame: () => {
          framebuffer?.requestRender()
          image?.requestRender()
        },
        onStatus: setStatus,
        onError: (error) => setProblem(error instanceof Error ? error.message : String(error)),
      })

      if (cancelled) {
        created.stop()
        return
      }
      session = created
      debug("window: session attached", { state: created.state })
      if (!props.panel.focused) created.pause()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  onMount(() => {
    start().catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
  })

  onCleanup(() => {
    debug("window: cleanup")
    cancelled = true
    detachKeys?.()
    detachKeys = undefined
    session?.stop()
    session = undefined
    framebuffer?.destroy()
    framebuffer = undefined
    image?.destroy()
    image = undefined
    pool?.dispose()
    pool = undefined
  })

  const footer = () => {
    const current = status()
    if (current.state === "loading") return "starting doomgeneric…"
    if (current.state === "error") return current.message ?? "engine error"
    if (current.state === "paused") return "paused · focus the panel to resume · esc closes"
    return `${current.fps} fps · wasd move · ←→ turn · space use · ctrl/f fire · shift run · tab map · m menu`
  }

  return (
    <box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center" gap={1} padding={1}>
      <Show
        when={!problem()}
        fallback={
          <box border borderColor={props.theme.border.base} padding={1} width={dimensions().cols + 2}>
            <text fg={props.theme.text.base}>{problem()}</text>
          </box>
        }
      >
        <box
          ref={(element) => {
            host = element ?? undefined
          }}
          border
          borderColor={props.theme.border.base}
          title=" DOOM — Knee-Deep in the Dead "
          titleAlignment="center"
          width={dimensions().cols + 2}
          height={dimensions().rows + 2}
        />
      </Show>
      <text fg={props.theme.text.muted}>{footer()}</text>
    </box>
  )
}
