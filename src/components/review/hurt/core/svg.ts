/**
 * A `data:` URL for an SVG this app drew itself.
 *
 * A blob: URL is a same-origin document, so "Open image in new tab" on one runs whatever script the SVG carries. These
 * previews are generated here rather than taken from the repository, but a data: URL cannot be opened as a top-level
 * page at all, so the hardening costs nothing and covers anything that later stops escaping its input.
 */
export function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
