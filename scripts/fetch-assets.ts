#!/usr/bin/env bun
/**
 * Downloads the runtime assets that are intentionally NOT committed to git:
 *
 *   vendor/engine/doom.js     doomgeneric compiled to WASM (from the MIT npm wrapper)
 *   vendor/engine/doom.wasm
 *   vendor/sound/*.wav|mp3    DOOM sound effects and music tracks
 *   vendor/doom1.wad          shareware DOOM1.WAD (Knee-Deep in the Dead)
 *
 * Usage:
 *   bun run fetch-assets            # everything
 *   bun run fetch-assets --no-sound # engine + wad only
 *   bun run fetch-assets --no-wad
 *
 * DOOM, doomgeneric: GPL-2.0. WAD and sound data: (c) id Software, shareware
 * redistribution. See NOTICE.
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const VENDOR = join(ROOT, "vendor")
const ENGINE_DIR = join(VENDOR, "engine")
const SOUND_DIR = join(VENDOR, "sound")
const MANIFEST = join(VENDOR, "assets.json")

/** MIT-licensed npm wrapper that ships a prebuilt doomgeneric WASM module. */
const ENGINE_PACKAGE = "@muhammedaksam/opentui-doom"
const ENGINE_VERSION = "0.4.0"
const ENGINE_TARBALL = `https://registry.npmjs.org/@muhammedaksam/opentui-doom/-/opentui-doom-${ENGINE_VERSION}.tgz`

/** Shareware DOOM1.WAD (v1.8, episode 1) from the idgames mirror. */
const WAD_CANDIDATES = [
  "https://ftp.fu-berlin.de/pc/games/idgames/idstuff/doom/doom-1.8.wad.gz",
  "https://ftp.fu-berlin.de/pc/games/idgames/idstuff/doom/doom19s.zip",
]

const args = new Set(Bun.argv.slice(2))
const withSound = !args.has("--no-sound")
const withWad = !args.has("--no-wad")

function log(message: string) {
  console.log(`[assets] ${message}`)
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function download(url: string) {
  log(`GET ${url}`)
  const response = await fetch(url, { headers: { "User-Agent": "opencode-doom" } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  return new Uint8Array(await response.arrayBuffer())
}

function write(path: string, bytes: Uint8Array) {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, bytes)
  log(`wrote ${path.slice(ROOT.length + 1)} (${(bytes.length / 1024).toFixed(0)} KiB)`)
}

async function fetchEngine(tmp: string) {
  const needed = [join(ENGINE_DIR, "doom.js"), join(ENGINE_DIR, "doom.wasm")]
  if (needed.every(existsSync)) {
    log("engine already present, skipping")
    return
  }

  const tarball = join(tmp, "engine.tgz")
  writeFileSync(tarball, await download(ENGINE_TARBALL))

  const extracted = join(tmp, "engine")
  mkdirSync(extracted, { recursive: true })
  const tar = Bun.spawnSync(["tar", "-xzf", tarball, "-C", extracted])
  if (tar.exitCode !== 0) throw new Error(`tar failed: ${tar.stderr.toString()}`)

  for (const file of ["doom.js", "doom.wasm"]) {
    const from = join(extracted, "package", "doom", "build", file)
    if (!existsSync(from)) throw new Error(`missing ${file} in ${ENGINE_PACKAGE}`)
    mkdirSync(ENGINE_DIR, { recursive: true })
    renameSync(from, join(ENGINE_DIR, file))
    log(`engine/${file} (${(statSync(join(ENGINE_DIR, file)).size / 1024).toFixed(0)} KiB)`)
  }
}

async function fetchSound(tmp: string) {
  if (!withSound) return
  if (existsSync(SOUND_DIR) && readdirSync(SOUND_DIR).length > 0) {
    log("sound already present, skipping")
    return
  }

  const tarball = join(tmp, "sound.tgz")
  writeFileSync(tarball, await download(ENGINE_TARBALL))
  const extracted = join(tmp, "sound")
  mkdirSync(extracted, { recursive: true })
  const tar = Bun.spawnSync(["tar", "-xzf", tarball, "-C", extracted])
  if (tar.exitCode !== 0) throw new Error(`tar failed: ${tar.stderr.toString()}`)

  const source = join(extracted, "package", "sound")
  if (!existsSync(source)) throw new Error(`missing sound/ in ${ENGINE_PACKAGE}`)
  mkdirSync(SOUND_DIR, { recursive: true })
  let count = 0
  for (const entry of readdirSync(source)) {
    renameSync(join(source, entry), join(SOUND_DIR, entry))
    count++
  }
  log(`sound/${count} files`)
}

async function fetchWad(tmp: string) {
  if (!withWad) return
  const target = join(VENDOR, "doom1.wad")
  if (existsSync(target) && statSync(target).size > 1_000_000) {
    log("doom1.wad already present, skipping")
    return
  }

  let lastError: unknown
  for (const url of WAD_CANDIDATES) {
    try {
      const bytes = await download(url)
      if (url.endsWith(".gz")) {
        const wad = Bun.gunzipSync(bytes)
        if (decodeHeader(wad) !== "IWAD") throw new Error("not an IWAD")
        write(target, wad)
        return
      }
      const archive = join(tmp, "wad.zip")
      writeFileSync(archive, bytes)
      const tar = Bun.spawnSync(["unzip", "-o", "-q", archive, "DOOM1.WAD", "-d", tmp])
      if (tar.exitCode !== 0) throw new Error(`unzip failed: ${tar.stderr.toString()}`)
      const wad = new Uint8Array(await Bun.file(join(tmp, "DOOM1.WAD")).arrayBuffer())
      if (decodeHeader(wad) !== "IWAD") throw new Error("not an IWAD")
      write(target, wad)
      return
    } catch (error) {
      lastError = error
      log(`failed: ${url}: ${String(error)}`)
    }
  }
  throw new Error(`could not download DOOM1.WAD: ${String(lastError)}`)
}

function decodeHeader(wad: Uint8Array) {
  return new TextDecoder().decode(wad.subarray(0, 4))
}

async function main() {
  mkdirSync(VENDOR, { recursive: true })
  const tmp = join(tmpdir(), `opencode-doom-assets-${Date.now()}`)
  mkdirSync(tmp, { recursive: true })

  try {
    await fetchEngine(tmp)
    await fetchSound(tmp)
    await fetchWad(tmp)

    const manifest: Record<string, { bytes: number; sha256: string }> = {}
    for (const [name, path] of [
      ["doom.js", join(ENGINE_DIR, "doom.js")],
      ["doom.wasm", join(ENGINE_DIR, "doom.wasm")],
      ["doom1.wad", join(VENDOR, "doom1.wad")],
    ] as const) {
      if (!existsSync(path)) continue
      const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
      manifest[name] = { bytes: bytes.length, sha256: sha256(bytes) }
    }
    const next = { engine: `${ENGINE_PACKAGE}@${ENGINE_VERSION}`, files: manifest }
    write(MANIFEST, new TextEncoder().encode(`${JSON.stringify(next, null, 2)}\n`))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

await main()
