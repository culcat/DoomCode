/**
 * A running DOOM instance: engine tick loop, half-block rendering, key state
 * and persistence. The TUI component owns presentation only.
 */
import { AudioPlayer } from "./audio"
import { Doom } from "./engine"
import { persistSaves, restoreSaves } from "./saves"
import { aspectCrop, renderHalfBlock, type CellSink } from "./render"
import { debug } from "./debug"

export type SessionState = "loading" | "running" | "paused" | "exiting" | "error"

export interface SessionStatus {
  state: SessionState
  fps: number
  message?: string
}

export interface GameSessionOptions {
  wad: string
  cols: number
  rows: number
  fps?: number
  sound?: boolean
  sink: CellSink
  /** Called after each rendered frame so the host can request a repaint. */
  onFrame: () => void
  onStatus?: (status: SessionStatus) => void
  onError?: (error: unknown) => void
  onExit?: () => void
}

/** How long a key stays pressed without a repeat or a real release event. */
const KEY_HOLD_MS = 160
const SAVE_SYNC_MS = 5000

export class GameSession {
  #options: GameSessionOptions
  #engine: Doom | undefined
  #audio: AudioPlayer | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  #cols: number
  #rows: number
  #state: SessionState = "loading"
  #frameTimes: number[] = []
  #fps = 0
  #heldCodes = new Map<number, number>()
  #releaseEvents = false
  #lastSaveSync = 0
  #lastStatusAt = 0
  #nextFrameAt = 0

  private constructor(options: GameSessionOptions) {
    this.#options = options
    this.#cols = options.cols
    this.#rows = options.rows
  }

  static async create(options: GameSessionOptions): Promise<GameSession> {
    const session = new GameSession(options)
    await session.#boot()
    return session
  }

  get state(): SessionState {
    return this.#state
  }

  get fps(): number {
    return this.#fps
  }

  get cols(): number {
    return this.#cols
  }

  get rows(): number {
    return this.#rows
  }

  get audio(): AudioPlayer | undefined {
    return this.#audio
  }

  async #boot(): Promise<void> {
    const { wad, sound, onError } = this.#options

    try {
      const audio = new AudioPlayer()
      this.#audio = audio
      const withSound = sound !== false && audio.available
      if (!withSound) audio.setEnabled(false)

      this.#engine = await Doom.create({
        wad,
        warp: true,
        sound: withSound,
        audio,
        onPrint: () => {},
      })

      restoreSaves(this.#engine)
      debug("session: engine ready", { wad, sound: withSound, audio: audio.backend })
      this.#setState("running")
      this.#nextFrameAt = performance.now()
      this.#schedule()
    } catch (error) {
      debug("session: boot failed", error)
      this.#setState("error", error instanceof Error ? error.message : String(error))
      onError?.(error)
    }
  }

  #setState(state: SessionState, message?: string): void {
    this.#state = state
    this.#options.onStatus?.({ state, fps: this.#fps, message })
  }

  #targetInterval(): number {
    const fps = Math.min(60, Math.max(10, this.#options.fps ?? 30))
    return 1000 / fps
  }

  #schedule(): void {
    if (this.#state !== "running") return
    const interval = this.#targetInterval()
    this.#nextFrameAt += interval
    const delay = Math.max(0, this.#nextFrameAt - performance.now())
    this.#timer = setTimeout(() => this.#frame(), delay)
  }

  #frame(): void {
    if (this.#state !== "running" || !this.#engine) return
    const started = performance.now()

    this.#releaseExpiredKeys()
    this.#engine.tick()

    const crop = aspectCrop(this.#cols, this.#rows)
    renderHalfBlock(this.#engine.sampler(), { cols: this.#cols, rows: this.#rows, crop }, this.#options.sink)
    this.#options.onFrame()

    const now = performance.now()
    this.#frameTimes.push(now - started)
    if (this.#frameTimes.length > 30) this.#frameTimes.shift()
    const average = this.#frameTimes.reduce((sum, value) => sum + value, 0) / this.#frameTimes.length
    this.#fps = Math.round(1000 / Math.max(average, this.#targetInterval()))
    if (now - this.#lastStatusAt > 1000) {
      this.#lastStatusAt = now
      this.#options.onStatus?.({ state: this.#state, fps: this.#fps })
      debug("fps", { fps: this.#fps, frameMs: Number(average.toFixed(2)) })
    }

    if (now - this.#lastSaveSync > SAVE_SYNC_MS) {
      this.#lastSaveSync = now
      if (this.#engine) persistSaves(this.#engine)
    }

    if (this.#nextFrameAt < now - 250) this.#nextFrameAt = now
    this.#schedule()
  }

  /** Called once a real key release arrives: the terminal speaks the kitty protocol. */
  noteReleaseEvents(): void {
    if (this.#releaseEvents) return
    this.#releaseEvents = true
    this.#heldCodes.clear()
  }

  get hasReleaseEvents(): boolean {
    return this.#releaseEvents
  }

  #releaseExpiredKeys(): void {
    if (!this.#engine || this.#releaseEvents || this.#heldCodes.size === 0) return
    const now = performance.now()
    for (const [code, expiresAt] of this.#heldCodes) {
      if (expiresAt > now) continue
      this.#engine.key(false, code)
      this.#heldCodes.delete(code)
    }
  }

  /** Queues a DOOM key. `pressed=false` releases immediately; presses auto-release. */
  key(code: number, pressed: boolean): void {
    if (!this.#engine) return
    if (pressed) {
      if (!this.#releaseEvents) this.#heldCodes.set(code, performance.now() + KEY_HOLD_MS)
      this.#engine.key(true, code)
    } else {
      this.#heldCodes.delete(code)
      this.#engine.key(false, code)
    }
  }

  resize(cols: number, rows: number): void {
    this.#cols = cols
    this.#rows = rows
  }

  pause(): void {
    if (this.#state !== "running") return
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#audio?.stopMusic()
    this.#setState("paused")
  }

  resume(): void {
    if (this.#state !== "paused") return
    this.#setState("running")
    this.#nextFrameAt = performance.now()
    this.#schedule()
  }

  setSound(enabled: boolean): void {
    this.#audio?.setEnabled(enabled)
  }

  /** Stops the loop, flushes saves and kills audio processes. */
  stop(): void {
    if (this.#state === "exiting") return
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined

    if (this.#engine) persistSaves(this.#engine)
    this.#audio?.shutdown()
    debug("session: stopped")
    this.#setState("exiting")
  }
}
