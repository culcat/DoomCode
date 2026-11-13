/**
 * Save games: DOOM keeps them inside the WASM virtual filesystem, this module
 * mirrors them to `~/.local/share/opencode/doom/saves`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { Doom } from "./engine"
import { savesDir } from "./paths"

export const SLOTS = [0, 1, 2, 3, 4, 5] as const

export function loadSaves(): Map<number, Uint8Array> {
  const directory = savesDir()
  const saves = new Map<number, Uint8Array>()
  if (!existsSync(directory)) return saves

  for (const entry of readdirSync(directory)) {
    const match = /^doomsav(\d)\.dsg$/.exec(entry)
    if (!match) continue
    const slot = Number(match[1])
    if (!SLOTS.includes(slot as (typeof SLOTS)[number])) continue
    saves.set(slot, new Uint8Array(readFileSync(join(directory, entry))))
  }
  return saves
}

/** Copies saves from disk into the running engine, so the load menu sees them. */
export function restoreSaves(engine: Doom): number {
  let restored = 0
  for (const [slot, data] of loadSaves()) {
    engine.writeSave(slot, data)
    restored++
  }
  return restored
}

/** Copies saves the player made in-game to disk. Returns how many were written. */
export function persistSaves(engine: Doom): number {
  const directory = savesDir()
  let written = 0

  for (const slot of SLOTS) {
    const data = engine.readSave(slot)
    if (!data || data.length === 0) continue
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, `doomsav${slot}.dsg`), data)
    written++
  }
  return written
}
