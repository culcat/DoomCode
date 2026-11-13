/**
 * Thin wrapper around the doomgeneric WASM build.
 *
 * The module is intentionally free of OpenTUI/OpenCode imports so it can be
 * exercised headlessly (`scripts/smoke.ts`).
 */
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { ENGINE_HEIGHT, ENGINE_WIDTH, assetsDir } from "./paths"

/** DOOM key codes from doomkeys.h, as pushed through DG_PushKeyEvent. */
export const DoomKey = {
  right: 0xae,
  left: 0xac,
  up: 0xad,
  down: 0xaf,
  strafeLeft: 0xa0,
  strafeRight: 0xa1,
  use: 0xa2,
  fire: 0xa3,
  escape: 27,
  enter: 13,
  tab: 9,
  backspace: 127,
  pause: 0xff,
  shift: 0x80 + 0x36,
  control: 0x80 + 0x1d,
  alt: 0x80 + 0x38,
  f1: 0x80 + 0x3b,
  f2: 0x80 + 0x3c,
  f3: 0x80 + 0x3d,
  f4: 0x80 + 0x3e,
  f5: 0x80 + 0x3f,
  f6: 0x80 + 0x40,
  f7: 0x80 + 0x41,
  f8: 0x80 + 0x42,
  f9: 0x80 + 0x43,
  f10: 0x80 + 0x44,
} as const

export interface AudioBridge {
  init(): void
  shutdown(): void
  sound(name: string, volume: number): void
  music(name: string, looping: boolean): void
  stopMusic(): void
  musicVolume(volume: number): void
}

export interface DoomOptions {
  wad: string
  /** Jump straight into E1M1 instead of the title/demo loop. */
  warp?: boolean
  sound?: boolean
  audio?: AudioBridge
  onPrint?: (line: string) => void
}

interface EmscriptenModule {
  _doomgeneric_Create: (argc: number, argv: number) => void
  _doomgeneric_Tick: () => void
  _DG_GetFrameBuffer: () => number
  _DG_PushKeyEvent: (pressed: number, key: number) => void
  _malloc: (size: number) => number
  _free: (ptr: number) => void
  setValue: (ptr: number, value: number, type: string) => void
  getValue: (ptr: number, type: string) => number
  FS_createPath: (parent: string, name: string, canRead: boolean, canWrite: boolean) => string
  FS_createDataFile: (
    parent: string,
    name: string,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
    canOwn?: boolean,
  ) => void
  FS?: {
    readFile: (path: string) => Uint8Array
    readdir: (path: string) => string[]
    writeFile: (path: string, data: Uint8Array) => void
    analyzePath: (path: string) => { exists: boolean }
  }
}

const WAD_VFS_PATH = "/doom/doom1.wad"
const DEFAULT_CFG = [
  "key_up 119", // w
  "key_down 115", // s
  "key_strafeleft 97", // a
  "key_straferight 100", // d
  "use_mouse 0",
  "screenblocks 10",
].join("\n")

export class Doom {
  readonly width = ENGINE_WIDTH
  readonly height = ENGINE_HEIGHT

  #module: EmscriptenModule
  #framePtr: number

  private constructor(module: EmscriptenModule) {
    this.#module = module
    this.#framePtr = module._DG_GetFrameBuffer()
  }

  static async create(options: DoomOptions): Promise<Doom> {
    const engineDir = join(assetsDir(), "engine")
    const wasmPath = join(engineDir, "doom.wasm")
    const jsPath = join(engineDir, "doom.js")

    const wad = readFileSync(options.wad)
    const require = createRequire(import.meta.url)
    const createModule = require(jsPath) as (config: Record<string, unknown>) => Promise<EmscriptenModule>

    const audio = options.sound === false ? undefined : options.audio
    const print = options.onPrint ?? (() => {})

    const module = await createModule({
      locateFile: (path: string) => (path.endsWith(".wasm") ? wasmPath : join(engineDir, path)),
      print,
      printErr: print,
      quitGame: () => {},
      initAudio: () => audio?.init(),
      shutdownAudio: () => audio?.shutdown(),
      playSound: (name: string, volume: number) => audio?.sound(name, volume),
      playMusic: (name: string, looping: boolean) => audio?.music(name, looping),
      stopMusic: () => audio?.stopMusic(),
      setMusicVolume: (volume: number) => audio?.musicVolume(volume),
      preRun: [
        (instance: EmscriptenModule) => {
          instance.FS_createPath("/", "doom", true, true)
          instance.FS_createDataFile("/doom", "doom1.wad", wad, true, false)
          instance.FS_createPath("/", ".savegame", true, true)
          const cfg = new TextEncoder().encode(DEFAULT_CFG + "\n")
          instance.FS_createDataFile("/", "default.cfg", cfg, true, false)
        },
      ],
    })

    const args = ["doom", "-iwad", WAD_VFS_PATH]
    if (options.warp !== false) args.push("-warp", "1", "1")

    const ptrs: number[] = []
    for (const arg of args) {
      const ptr = module._malloc(arg.length + 1)
      for (let i = 0; i < arg.length; i++) module.setValue(ptr + i, arg.charCodeAt(i), "i8")
      module.setValue(ptr + arg.length, 0, "i8")
      ptrs.push(ptr)
    }
    const argv = module._malloc(ptrs.length * 4)
    ptrs.forEach((ptr, index) => module.setValue(argv + index * 4, ptr, "i32"))

    module._doomgeneric_Create(args.length, argv)
    ptrs.forEach((ptr) => module._free(ptr))
    module._free(argv)

    return new Doom(module)
  }

  /** Advances the game by one frame. */
  tick(): void {
    this.#module._doomgeneric_Tick()
  }

  /**
   * One ARGB pixel as `0xRRGGBB`.
   *
   * The WASM build does not export its heap, so pixels go through the glue's
   * `getValue`. Coarse sampling keeps this at a few thousand calls per frame.
   */
  readPixel(x: number, y: number): number {
    const value = this.#module.getValue(this.#framePtr + (y * this.width + x) * 4, "i32") >>> 0
    return value & 0xffffff
  }

  /** Sampler bound to the current frame, for `renderHalfBlock`. */
  sampler(): (x: number, y: number) => number {
    return (x, y) => this.readPixel(x, y)
  }

  /** Queues a key press or release. DOOM polls these events itself. */
  key(pressed: boolean, code: number): void {
    this.#module._DG_PushKeyEvent(pressed ? 1 : 0, code)
  }

  /** Reads a save slot from the virtual FS, if the player saved in this session. */
  readSave(slot: number): Uint8Array | undefined {
    const fs = this.#module.FS
    if (!fs) return undefined
    const name = `doomsav${slot}.dsg`
    for (const dir of ["/", "/.savegame", "/doom"]) {
      const path = `${dir === "/" ? "" : dir}/${name}`
      if (fs.analyzePath(path).exists) return fs.readFile(path)
    }
    return undefined
  }

  writeSave(slot: number, data: Uint8Array): void {
    const fs = this.#module.FS
    if (!fs) return
    fs.writeFile(`/.savegame/doomsav${slot}.dsg`, data)
    fs.writeFile(`/doomsav${slot}.dsg`, data)
  }
}
