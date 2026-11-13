# DoomCode

DOOM in the OpenCode TUI. `/doom` opens a small window inside a session panel and runs
**Knee-Deep in the Dead** — the shareware first episode — on a real `doomgeneric` engine
compiled to WebAssembly.

No external app, no browser, no DOSBox: the engine ticks inside the TUI process and paints
up to four pixels per terminal cell with quadrant block glyphs, so a 74×23 panel still shows
a 148×92 picture. If the terminal exposes Kitty graphics or Sixel, the panel switches to
native pixels (640×400) instead.

## Requirements

- OpenCode 2.2+ (only the TUI part is used)
- A terminal with truecolor; `kitty` keyboard protocol support is a bonus (key releases
  arrive natively)
- Optional: `mpv` for sound. Without it the plugin falls back to macOS `afplay`, and with
  neither the game is simply silent.

## Install

```bash
git clone git@github.com:culcat/DoomCode.git
cd DoomCode
bun install
bun run fetch-assets     # engine + sound + shareware DOOM1.WAD (~13 MB, not in git)
```

Register the plugin in `~/.config/opencode/cli.json`:

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/DoomCode"]
}
```

OpenCode reloads it without a restart. Run `/doom` (or pick *DOOM: play Knee-Deep in the
Dead* in the command palette) from any session. `Esc` closes the window and saves.

## Rendering modes

| `render` | What it does | Cells → pixels |
| --- | --- | --- |
| `auto` (default) | Native pixels when the terminal supports Kitty/Sixel, otherwise quadrant cells | 148×92 or 640×400 |
| `quadrant` | 2×2 pixels per cell with block glyphs (`▘▝▖▗▚▞` …), two colours per cell | panel width ×2 |
| `half` | Upper half block `▀`: two pixels per cell, works in every terminal | panel width ×1 |
| `image` | Always native pixels; falls back to quadrant cells when the terminal reports only block rendering | 640×400 |

Quadrant cells are the default on terminals OpenCode does not report as graphic-capable. They
give twice the detail of `half` in both axes at roughly the same frame cost.

## Controls

| Action | Keys |
| --- | --- |
| Move forward / back | `W` / `S`, `↑` / `↓` |
| Turn | `←` / `→` |
| Strafe | `A` / `D` |
| Fire | `Ctrl` or `F` |
| Use / open doors | `Space` or `E` |
| Run | `Shift` |
| Weapons | `1`–`7` |
| Automap | `Tab` |
| DOOM menu | `M` |
| Pause | `P` |
| Close the window | `Esc` |

`Esc` belongs to OpenCode, so DOOM's own menu key is `M`. Keys only reach the game while the
panel is focused; switching away pauses the engine and silences music.

## Configuration

```jsonc
// ~/.config/opencode/opencode.jsonc or cli.json
{
  "plugins": [
    {
      "package": "/absolute/path/to/DoomCode",
      "options": {
        "cols": 88,        // preferred window width in cells (shrinks to fit the panel)
        "rows": 28,        // defaults to a 16:10 window derived from cols
        "fps": 30,         // 10..60
        "sound": true,
        "wad": "/path/to/DOOM.WAD",
        "render": "auto"   // auto | image | quadrant | half
      }
    }
  ]
}
```

The IWAD is resolved in this order: `options.wad`, `DOOM_WAD`, `~/.local/share/opencode/doom/doom1.wad`,
then the checkout's `vendor/doom1.wad`. If none exists, `/doom` offers to download the
shareware episode.

Assets live outside git:

```
vendor/engine/doom.cjs     doomgeneric WASM glue (GPL-2.0 build)
vendor/engine/doom.wasm
vendor/doom1.wad           shareware episode 1
vendor/sound/*.wav|mp3     DOOM sound effects and music
~/.local/share/opencode/doom/saves/doomsav0..5.dsg
```

## How it works

- `src/tui.tsx` registers the `/doom` command and claims `session.panel`.
- `src/window.tsx` owns the window: a `FrameBufferRenderable` mounted in a bordered box,
  reactive sizing, and the key stream while the panel is focused.
- `src/session.ts` runs the loop: `doomgeneric_Tick`, half-block rendering with area
  sampling, FPS/status reporting, auto-release for terminals that never send key releases,
  and save syncing.
- `src/engine.ts` loads the Emscripten glue, feeds it the WAD through the in-memory
  filesystem, and exposes `tick`, `readPixel` and `key`.
- `src/render.ts` turns pixels into cells: quadrant blocks (2×2 per cell) or `▀` (1×2), with
  a letterboxed 16:10 crop.
- `src/frames.ts` downscales ARGB frames to RGBA for the native image presenter.
- `src/audio.ts` plays SFX and looping music through `mpv`, or `afplay` on macOS.

Measured on an M-series Mac in Ghostty: 30 fps steady, ~6 ms per frame at 74×23 cells.

## Development

```bash
bun run typecheck      # tsc --noEmit
bun run smoke          # headless engine benchmark (no TUI)
bun run window-check   # renders the real window in an in-memory renderer, presses keys
bun run saves-check    # save round-trip
bun run dump-frames    # writes /tmp/doom-frame-*.png
bun run compare-render # half-block vs quadrant, side by side in /tmp
```

`bunfig.toml` preloads the Solid transform (`@opentui/solid/bun-plugin`); JSX only behaves
reactively when it is compiled in Solid mode, and OpenCode does the same for plugins it loads.

Set `DOOMCODE_DEBUG=1` to append diagnostics to `/tmp/opencode-doom.log`
(`DOOMCODE_DEBUG=/path/file` to choose another path). The log records plugin setup, engine
boot, focus changes, key presses and FPS.

## Troubleshooting

- **`/doom` says "Open a session tab first"** — open or create a session; panels are
  session-scoped.
- **Keys type into the prompt instead of the game** — the panel lost focus; click it or press
  `Esc` and reopen. Run with `DOOMCODE_DEBUG=1` and check `panel: focused`.
- **Movement stutters** — the terminal does not send key releases, so the plugin synthesises
  them after 160 ms. Ghostty, kitty, WezTerm and iTerm2 with kitty protocol give smooth input.
- **No sound** — install `mpv` (`brew install mpv`); otherwise check that `vendor/sound`
  exists (rerun `bun run fetch-assets`).

## License

GPL-2.0-only, because the engine is GPL-2.0. DOOM shareware data is (c) id Software and is
never committed or bundled. See [NOTICE](NOTICE).
