#!/usr/bin/env bun
/** Round-trips a save slot between the wasm filesystem and the saves directory. */
import { existsSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { Doom } from "../src/engine"
import { resolveWad, savesDir } from "../src/paths"
import { persistSaves, restoreSaves } from "../src/saves"

const wad = resolveWad()
if (!wad) throw new Error("no WAD: run `bun run fetch-assets`")

const engine = await Doom.create({ wad: wad.path, warp: true, sound: false, onPrint: () => {} })
const enginePayload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
const diskPayload = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9])

// engine -> disk
engine.writeSave(3, enginePayload)
const written = persistSaves(engine)
const file = join(savesDir(), "doomsav3.dsg")
if (!existsSync(file)) throw new Error(`save file missing: ${file}`)

// disk -> engine
writeFileSync(file, diskPayload)
const restored = restoreSaves(engine)
const back = engine.readSave(3)

console.log(`persisted: ${written}, restored: ${restored}, bytes: ${back?.length ?? 0}`)
rmSync(file)

if (restored !== 1) throw new Error("restoreSaves did not load the slot")
if (!back || back.length !== diskPayload.length) throw new Error("save did not round-trip")
console.log("OK")
