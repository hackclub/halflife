/**
 * An empty stand-in for Node's `fs`, `path` and `crypto` in browser bundles (see `turbopack.resolveAlias` in next.config.ts).
 *
 * The file viewer's Emscripten builds (libarchive-wasm, occt-import-js) `require` them on the Node branch of a runtime check they never take in a browser; Vite leaves those requires unresolved, Turbopack refuses to build without a module to point them at.
 */
const stub = {}
export default stub
