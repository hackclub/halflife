/**
 * A project's repo link, as typed and as shown.
 *
 * People paste `github.com/me/hackpad`, `https://github.com/me/hackpad.git`,
 * or the URL with a trailing slash, and all of those mean the same repo. The
 * API takes any http(s) URL — a GitLab or Codeberg repo is a repo too — so the
 * only work here is adding the scheme people leave off and refusing what will
 * not parse, before a round trip says the same thing less helpfully.
 */
export function normalizeRepo(input: string): { url: string | null; error: string | null } {
  const raw = input.trim();
  if (!raw) return { url: null, error: null };
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { url: null, error: "That needs to be a web link." };
    }
    if (!parsed.hostname.includes(".")) {
      return { url: null, error: "That does not look like a repo link." };
    }
    return { url: parsed.toString().replace(/\/$/, ""), error: null };
  } catch {
    return { url: null, error: "That does not look like a repo link." };
  }
}

/** `github.com/me/hackpad` — the link without the parts nobody reads. */
export function displayRepo(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}
