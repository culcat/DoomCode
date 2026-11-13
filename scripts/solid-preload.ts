/**
 * Bun preload: registers the Solid transform for `.tsx` sources.
 *
 * OpenCode does the same for plugins it loads; the dev harness needs it so JSX
 * compiles to fine-grained reactive code instead of React-style calls.
 */
import { ensureSolidTransformPlugin } from "@opentui/solid/bun-plugin"

ensureSolidTransformPlugin()
