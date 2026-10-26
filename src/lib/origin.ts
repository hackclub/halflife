/**
 * The configured public origin, and the hosts that are allowed to name one.
 *
 * A leaf module on purpose: the proxy imports it (so no `server-only`, no node built-ins) and `lib/auth.ts` imports it too, and neither should drag the other's dependencies in.
 */

/**
 * The hosts this deployment serves.
 *
 * An exact list, never a wildcard over a shared domain. `*.k.hackclub.dev` is a wildcard many unrelated projects sit behind, so anyone who controls any subdomain there could name a host this deployment would then trust – and a trusted host is one a redirect may point at.
 *
 * The two here are the ones this deployment answers on: the vanity domain people are sent to, and the Orchard ingress in the runbook. `APP_PUBLIC_HOSTS` carries the list so a deployment reached on another name can correct it without a code change.
 */
const DEFAULT_PUBLIC_HOSTS = ["halflife.hackclub.com", "half-life.k.hackclub.dev"]

/**
 * The hosts this deployment serves, from `APP_PUBLIC_HOSTS` or the default list.
 *
 * A `*` in a pattern matches any run of characters, the way better-auth reads a host pattern, so one list can drive both the redirect resolver and better-auth's allowed hosts.
 */
export function publicHosts(): string[] {
	const configured = (process.env.APP_PUBLIC_HOSTS ?? "")
		.split(",")
		.map(host => host.trim().toLowerCase())
		.filter(Boolean)
	return configured.length > 0 ? configured : [...DEFAULT_PUBLIC_HOSTS]
}

/** Does this hostname name a host we serve? */
export function isPublicHost(hostname: string): boolean {
	const host = hostname.trim().toLowerCase()
	return publicHosts().some(pattern => matchesHostPattern(host, pattern))
}

/** Does this hostname match the pattern? `*` matches any run of characters. */
function matchesHostPattern(host: string, pattern: string): boolean {
	if (!pattern.includes("*")) return host === pattern
	const source = pattern.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`).replaceAll("*", String.raw`[^/\\]*`)
	return new RegExp(`^${source}$`).test(host)
}

/**
 * The origin this deployment is configured to answer on, or null when it names none.
 *
 * `NEXT_PUBLIC_APP_URL` is the deployment's own answer and wins; `BETTER_AUTH_URL` is what a local checkout usually has set. Both are read at call time rather than at module load, because the same build runs in more than one environment.
 *
 * There is no third answer. A deployment that names no origin has none, and the callers decide what to do about that – a hardcoded production host would point a staging deployment's links at the live site, and the request's own host is whatever the caller put in the `Host` header.
 */
export function configuredOrigin(): string | null {
	for (const value of [process.env.NEXT_PUBLIC_APP_URL, process.env.BETTER_AUTH_URL]) {
		const origin = parseOrigin(value)
		if (origin) return origin
	}
	return null
}

/**
 * The origin of a configured URL, or null when it is not one.
 *
 * The path is kept and the trailing slash dropped, so a deployment served under a prefix keeps it in the links it writes.
 */
function parseOrigin(value: string | undefined): string | null {
	const raw = value?.trim()
	if (!raw) return null
	try {
		const url = new URL(raw)
		if (url.protocol !== "http:" && url.protocol !== "https:") return null
		return `${url.origin}${url.pathname.replace(/\/$/, "")}`
	} catch {
		return null
	}
}

/**
 * The hostname of a `Host` header value, or null when the value is not a plain host.
 *
 * Parsed rather than split on the colon: `[::1]:3000` splits to `[`, and a value carrying a path or a userinfo is not a host header at all.
 */
export function hostName(host: string): string | null {
	try {
		const url = new URL(`http://${host}`)
		if (url.pathname !== "/" || url.search || url.hash) return null
		if (url.username || url.password) return null
		return url.hostname.toLowerCase()
	} catch {
		return null
	}
}

/**
 * Is this hostname the machine's own?
 *
 * The names, and the whole of `127.0.0.0/8` – which a prefix test gets wrong: `127.0.0.1.attacker.example` starts with `127.` but is a domain somebody else owns.
 */
export function isLoopbackHostname(hostname: string): boolean {
	const bare = hostname
		.trim()
		.toLowerCase()
		.replaceAll(/^\[|\]$/g, "")
	if (bare === "localhost" || bare.endsWith(".localhost")) return true
	if (bare === "::1" || bare === "0:0:0:0:0:0:0:1") return true
	return LOOPBACK_IPV4.test(bare)
}

/** Is this `Host` header the machine's own? */
export function isLoopbackHost(host: string): boolean {
	const name = hostName(host)
	return name !== null && isLoopbackHostname(name)
}

/** The whole of `127.0.0.0/8`, and nothing that merely starts with `127.`. */
const LOOPBACK_IPV4 = /^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
