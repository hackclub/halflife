/**
 * `Bun.SQL` types for the scripts that read or reset a database directly, without the rest of `bun-types`.
 *
 * Same reason as `bun-test.d.ts`: a full `types: ["bun-types"]` entry replaces the global `fetch` with Bun's (which has `preconnect`), and the fetch mocks in `scripts/verify-*.ts` stop satisfying it. `sql.d.ts` imports `bun:sqlite` for the shared client types, so both declarations are pulled in together.
 */
import "bun-types/sqlite"
import "bun-types/sql"
