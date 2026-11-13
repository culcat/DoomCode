/**
 * Filesystem locations for engine assets (not in git) and user data (saves).
 *
 * Assets are looked up in this order:
 *   1. `DOOMCODE_ASSETS` — explicit override
 *   2. `<package>/vendor`  — what `bun run fetch-assets` produces in a checkout
 *   3. `~/.local/share/opencode/doom` — installed plugin fallback
 *
 * User data always lives in `DOOMCODE_HOME` or `~/.local/share/opencode/doom`.
 */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const PACKAGE_ROOT = join(import.meta.dir, "..")

export const ENGINE_WIDTH = 1280
export const ENGINE_HEIGHT = 800

export function dataDir(): string {
  return process.env.DOOMCODE_HOME ?? join(homedir(), ".local", "share", "opencode", "doom")
}

export function assetsDir(): string {
  const override = process.env.DOOMCODE_ASSETS
  if (override && existsSync(join(override, "engine", "doom.wasm"))) return override

  const local = join(PACKAGE_ROOT, "vendor")
  if (existsSync(join(local, "engine", "doom.wasm"))) return local

  return dataDir()
}

/** Sounds live beside the engine assets, but may be absent when `--no-sound` was used. */
export function soundDir(): string {
  return join(assetsDir(), "sound")
}

export function savesDir(): string {
  return join(dataDir(), "saves")
}

export interface WadSource {
  path: string
  origin: "option" | "env" | "data" | "assets"
}

/** Resolves the IWAD without touching the network. `undefined` means "ask the user". */
export function resolveWad(explicit?: string): WadSource | undefined {
  const candidates: Array<[string | undefined, WadSource["origin"]]> = [
    [explicit, "option"],
    [process.env.DOOM_WAD, "env"],
    [join(dataDir(), "doom1.wad"), "data"],
    [join(assetsDir(), "doom1.wad"), "assets"],
  ]

  for (const [path, origin] of candidates) {
    if (path && existsSync(path)) return { path, origin }
  }
  return undefined
}

/** True when the vendored runtime assets are installed. */
export function assetsInstalled(): boolean {
  return existsSync(join(assetsDir(), "engine", "doom.wasm"))
}
