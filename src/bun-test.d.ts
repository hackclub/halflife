/**
 * `bun:test` types for the unit tests, without the rest of `bun-types`.
 *
 * A full `types: ["bun-types"]` entry (or triple-slash reference, which Oxlint bans) also replaces the global `fetch` with Bun's (which has `preconnect`), and the fetch mocks in `scripts/verify-*.ts` no longer satisfy it. `test.d.ts` is self-contained – it only declares the `bun:test` module – so import it alone.
 */
import "bun-types/test"
