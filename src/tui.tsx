/**
 * OpenCode TUI plugin entry point.
 *
 * Registers the `/doom` command and hosts the game window in `session.panel`.
 * The window itself lives in `window.tsx`.
 */
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { Show } from "solid-js"

import { DoomWindow, type DoomOptions } from "./window"
import { debug } from "./debug"

const PANEL = "doom.game"

function readOptions(raw: Readonly<Record<string, unknown>>): DoomOptions {
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)
  return {
    cols: number(raw.cols),
    rows: number(raw.rows),
    fps: number(raw.fps),
    sound: typeof raw.sound === "boolean" ? raw.sound : undefined,
    wad: typeof raw.wad === "string" ? raw.wad : undefined,
  }
}

export default Plugin.define({
  id: "doom.tui",
  setup(context) {
    const options = readOptions(context.options)

    const unregister = context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === PANEL}>
          <PanelHost panel={panel} options={options} />
        </Show>
      ),
    })

    context.keymap.layer(() => ({
      mode: "global",
      priority: 20,
      commands: [
        {
          id: "doom.play",
          title: "DOOM: play Knee-Deep in the Dead",
          description: "Open the shareware first episode in a panel",
          group: "Doom",
          palette: true,
          slash: { name: "doom" },
          suggested: true,
          run: () => {
            const route = context.ui.router.current()
            const opened = context.ui.panel.open(PANEL)
            debug("command: /doom", {
              opened,
              route: route.type,
              tabs: context.ui.tabs.enabled(),
              panel: context.ui.panel.current(),
            })
            if (!opened) {
              context.ui.toast.show({ message: "Open a session tab first", variant: "warning" })
            }
          },
        },
      ],
    }))

    debug("plugin: ready", { options })

    return () => {
      debug("plugin: dispose")
      unregister()
    }
  },
})

function PanelHost(props: { panel: Parameters<typeof DoomWindow>[0]["panel"]; options: DoomOptions }) {
  const context = usePlugin()

  return (
    <DoomWindow
      renderer={context.renderer}
      panel={{
        name: props.panel.name,
        width: props.panel.width,
        focused: props.panel.focused,
        close: props.panel.close,
        focus: props.panel.focus,
      }}
      theme={context.theme}
      ui={{
        confirm: (options) => context.ui.dialog.confirm(options),
        toast: (options) => context.ui.toast.show(options),
      }}
      options={props.options}
    />
  )
}
