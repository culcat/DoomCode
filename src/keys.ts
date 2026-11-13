/**
 * OpenTUI key events -> DOOM key codes.
 *
 * DOOM wants one code per physical key; the mapping below keeps WASD for
 * movement and moves DOOM's own menu key to `M`, because `Escape` belongs to
 * the host UI.
 */
import { DoomKey } from "./engine"

export interface DoomKeyEvent {
  name: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
  option?: boolean
  eventType?: "press" | "repeat" | "release"
}

const NAMED: Record<string, number> = {
  up: DoomKey.up,
  down: DoomKey.down,
  left: DoomKey.left,
  right: DoomKey.right,
  space: DoomKey.use,
  enter: DoomKey.fire,
  tab: DoomKey.tab,
  backspace: DoomKey.backspace,
}

const LETTERS: Record<string, number> = {
  w: 0x77,
  a: 0x61,
  s: 0x73,
  d: 0x64,
  y: 0x79,
  n: 0x6e,
  e: DoomKey.use,
  f: DoomKey.fire,
  m: DoomKey.escape,
  p: DoomKey.pause,
}

/** Returns the DOOM key code for an event, or `undefined` when the key is not part of the game. */
export function toDoomKey(event: DoomKeyEvent): number | undefined {
  if (event.ctrl) return DoomKey.control
  if (event.option) return DoomKey.alt
  if (event.shift) return DoomKey.shift

  const named = NAMED[event.name]
  if (named !== undefined) return named

  if (/^[1-7]$/.test(event.name)) return event.name.charCodeAt(0)

  const letter = LETTERS[event.name]
  if (letter !== undefined) return letter

  const fn = /^f([1-9]|1[0-2])$/.exec(event.name)
  if (fn) return 0x80 + 0x3a + Number(fn[1])

  return undefined
}

/** Keys that should never reach the game, so the host keeps working. */
export function isHostKey(event: DoomKeyEvent): boolean {
  return event.name === "escape" || event.name === "q" || event.ctrl === true && event.name === "c"
}
