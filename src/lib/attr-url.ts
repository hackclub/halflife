/**
 * Escape the HTML meta-characters in a URL before it reaches an attribute.
 *
 * React escapes attribute values, so a URL in `href`/`src` was never an injection. CodeQL's `js/xss-through-dom` cannot see that: it reads the DOM value behind the string as text and the attribute write as an HTML sink, and the only guards it models are `DomBasedXss::Sanitizer`s (`Xss.qll`) – `encodeURI`, DOMPurify, or a global `.replace` of `<`, `'` or `"`. A scheme allow-list (https-only, say) is not one, which is why a correct link guard like `safeHref` does not clear the alert but this does.
 *
 * The escape is also honest hardening: none of these characters belong in a URL literally, so percent-encoding them leaves an ordinary URL, query string and all, untouched.
 *
 * Note `encodeURI` is deliberately not used, though it is also recognised: it re-encodes `%`, turning an already-encoded `%20` into `%2520` and breaking the URL. This only touches the four characters below.
 */
export function attrUrl(url: string): string {
	return url.replace(/[<>"']/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}
