/**
 * Shareware IWAD download.
 *
 * The WAD is id Software shareware data: it is not committed to git and is not
 * bundled with the plugin. It is fetched on first use and cached in the data
 * directory. Players may point `options.wad` or `DOOM_WAD` at any IWAD instead.
 */
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export const WAD_CANDIDATES = [
  "https://ftp.fu-berlin.de/pc/games/idgames/idstuff/doom/doom-1.8.wad.gz",
  "https://ftp.fu-berlin.de/pc/games/idgames/idstuff/doom/doom19s.zip",
] as const

export const WAD_FILENAME = "doom1.wad"

export type Progress = (received: number, total: number) => void

function isIwad(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, 4)) === "IWAD"
}

async function fetchBytes(url: string, progress?: Progress): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { "User-Agent": "opencode-doom" } })
  if (!response.ok || !response.body) throw new Error(`${response.status} ${response.statusText}: ${url}`)

  const total = Number(response.headers.get("content-length") ?? 0)
  const chunks: Uint8Array[] = []
  let received = 0

  for await (const chunk of response.body) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
    chunks.push(bytes)
    received += bytes.length
    progress?.(received, total)
  }

  const merged = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

/** Downloads the shareware WAD to `target`. Returns the path. */
export async function downloadWad(target: string, progress?: Progress): Promise<string> {
  mkdirSync(dirname(target), { recursive: true })

  let lastError: unknown
  for (const url of WAD_CANDIDATES) {
    try {
      const payload = await fetchBytes(url, progress)

      if (url.endsWith(".gz")) {
        const wad = Bun.gunzipSync(payload.buffer as ArrayBuffer)
        if (!isIwad(wad)) throw new Error("downloaded file is not an IWAD")
        writeFileSync(target, wad)
        return target
      }

      // Fallback archive: extract DOOM1.WAD next to the target.
      const archive = join(dirname(target), "doom-shareware.zip")
      writeFileSync(archive, payload)
      const unzip = Bun.spawnSync(["unzip", "-o", "-q", archive, "DOOM1.WAD", "-d", dirname(target)])
      if (unzip.exitCode !== 0) throw new Error(`unzip failed: ${unzip.stderr.toString()}`)
      const extracted = join(dirname(target), "DOOM1.WAD")
      if (!existsSync(extracted)) throw new Error("archive did not contain DOOM1.WAD")
      writeFileSync(target, new Uint8Array(await Bun.file(extracted).arrayBuffer()))
      return target
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(`could not download DOOM1.WAD: ${String(lastError)}`)
}

export function isValidWad(path: string): boolean {
  if (!existsSync(path) || statSync(path).size < 1_000_000) return false
  const fd = openSync(path, "r")
  try {
    const head = new Uint8Array(4)
    readSync(fd, head, 0, 4, 0)
    return isIwad(head)
  } finally {
    closeSync(fd)
  }
}
