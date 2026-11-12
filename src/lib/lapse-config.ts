/** Where Lapse's API lives. Its own module so lib/auth can read it without importing lib/lapse, which reaches back into auth through the OAuth token. */
export const LAPSE_API_BASE = (process.env.LAPSE_API_BASE ?? "https://api.lapse.hackclub.com/api").replace(/\/$/, "")
