/**
 * Opt-in debug logging. Set `DOOMCODE_DEBUG=1` to append to
 * `/tmp/opencode-doom.log`, or `DOOMCODE_DEBUG=/path/to/file` for a custom path.
 *
 * A TUI has no console, and OpenCode's own logs do not include plugin
 * `console.log` output, so this is the practical way to trace the plugin.
 */
import { appendFileSync } from "node:fs"

const path = process.env.DOOMCODE_DEBUG

export function debug(message: string, data?: unknown): void {
  if (!path) return
  const target = path === "1" ? "/tmp/opencode-doom.log" : path
  const suffix = data === undefined ? "" : ` ${safeStringify(data)}`
  try {
    appendFileSync(target, `${new Date().toISOString()} ${message}${suffix}\n`)
  } catch {
    // Logging must never break the game.
  }
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
