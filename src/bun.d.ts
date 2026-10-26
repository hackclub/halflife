/**
 * The one Bun global this app calls directly: `Bun.sleep`.
 *
 * Declared here rather than through `types: ["bun-types"]` for the reason given in `bun-test.d.ts`: the full definitions replace the global `fetch` with Bun's, and the fetch mocks in `scripts/verify-*.ts` stop satisfying it.
 *
 * Server code goes through `sleep` in `lib/concurrency`, which calls `Bun.sleep` when Bun is the runtime and falls back to `node:timers/promises` when it is Node (`next start`, which is how CI's e2e run starts the server). The scripts call `Bun.sleep` directly, because every script is run with `bun`.
 */
declare const Bun: {
	sleep(milliseconds: number): Promise<void>
}
