/**
 * DOOM sound through an external player.
 *
 * `mpv` is preferred (looping music, IPC volume control); macOS `afplay` is the
 * fallback so the plugin works without extra installs. Both are optional: with
 * neither present the game is simply silent.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { createConnection } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { soundDir } from "./paths"

type Backend = "mpv" | "afplay" | "none"

const MAX_CONCURRENT_SFX = 6

function findCommand(name: string): string | undefined {
  const result = spawnSync("which", [name], { encoding: "utf8" })
  if (result.status !== 0) return undefined
  const path = result.stdout.trim()
  return path.length > 0 && existsSync(path) ? path : undefined
}

export class AudioPlayer {
  readonly backend: Backend
  readonly directory: string

  #mpv: string | undefined
  #afplay: string | undefined
  #music: ChildProcess | undefined
  #musicPath: string | undefined
  #musicSocket = join(tmpdir(), `opencode-doom-mpv-${process.pid}.sock`)
  #sfx = new Set<ChildProcess>()
  #volume = 100
  #enabled = true

  constructor() {
    this.directory = soundDir()
    this.#mpv = findCommand("mpv")
    this.#afplay = findCommand("afplay")
    this.backend = this.#mpv ? "mpv" : this.#afplay ? "afplay" : "none"
  }

  get available(): boolean {
    return this.backend !== "none" && existsSync(this.directory)
  }

  init(): void {
    this.#enabled = true
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled
    if (!enabled) this.stopMusic()
  }

  get enabled(): boolean {
    return this.#enabled
  }

  sound(name: string, volume: number): void {
    if (!this.#enabled || !this.available) return
    if (this.#sfx.size >= MAX_CONCURRENT_SFX) return

    const path = join(this.directory, `ds${name.toLowerCase()}.wav`)
    if (!existsSync(path)) return

    const level = Math.round((Math.min(127, Math.max(0, volume)) / 127) * 100)
    const process = this.#spawnSfx(path, level)
    if (!process) return

    this.#sfx.add(process)
    process.once("exit", () => this.#sfx.delete(process))
  }

  music(name: string, looping: boolean): void {
    if (!this.#enabled || !this.available) return
    this.stopMusic()

    const path = join(this.directory, `${name.toLowerCase()}.mp3`)
    if (!existsSync(path)) return

    this.#musicPath = looping ? path : undefined
    this.#music = this.#startMusic(path, looping)
  }

  stopMusic(): void {
    this.#musicPath = undefined
    if (!this.#music) return
    this.#music.kill("SIGTERM")
    this.#music = undefined
  }

  musicVolume(volume: number): void {
    this.#volume = Math.min(127, Math.max(0, volume))
    if (!this.#music || !this.#mpv) return

    const level = Math.round((this.#volume / 127) * 100)
    const socket = createConnection(this.#musicSocket)
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ command: ["set_property", "volume", level] })}\n`)
      socket.end()
    })
    socket.on("error", () => socket.destroy())
  }

  shutdown(): void {
    this.stopMusic()
    for (const process of this.#sfx) process.kill("SIGKILL")
    this.#sfx.clear()
  }

  #spawnSfx(path: string, volume: number): ChildProcess | undefined {
    if (this.#mpv) {
      return spawn(this.#mpv, ["--no-video", "--no-terminal", "--really-quiet", `--volume=${volume}`, path], {
        stdio: "ignore",
        detached: true,
      })
    }
    if (this.#afplay) {
      return spawn(this.#afplay, ["-v", String(volume / 100), path], { stdio: "ignore", detached: true })
    }
    return undefined
  }

  #startMusic(path: string, looping: boolean): ChildProcess | undefined {
    const volume = Math.round((this.#volume / 127) * 100)

    if (this.#mpv) {
      const args = ["--no-video", "--no-terminal", "--really-quiet", `--volume=${volume}`, `--input-ipc-server=${this.#musicSocket}`]
      if (looping) args.push("--loop=inf")
      args.push(path)
      return spawn(this.#mpv, args, { stdio: "ignore" })
    }

    const afplay = this.#afplay
    if (!afplay) return undefined

    const play = (): ChildProcess => {
      const child = spawn(afplay, ["-v", String(volume / 100), path], { stdio: "ignore" })
      child.once("exit", () => {
        // `afplay` cannot loop, so restart while this track is still current.
        if (this.#musicPath === path) this.#music = play()
      })
      return child
    }
    return play()
  }
}
