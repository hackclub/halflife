import { mock } from "bun:test"

/**
 * Resolve `server-only` the way Next does for server code.
 *
 * The package exists to make an accidental client import a build error: its default entry throws on import, and the `react-server` condition points at an empty module instead. Tests import server modules for their logic all the time, so without the condition every one of them fails before a single assertion runs. The `test` script passes `--conditions=react-server`; this preload makes a bare `bun test` do the same.
 */
await mock.module("server-only", () => ({}))
