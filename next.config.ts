import type { NextConfig } from "next"
import { contentSecurityPolicy } from "./src/lib/csp"

// `output: "standalone"` traces the whole dependency graph, which is what the container image needs and pure overhead for a local `pnpm build`. Gate it on the two env vars that only ever appear in CI or a Docker build.
const isDeployBuild = Boolean(process.env.CI || process.env.DOCKER_BUILD)

const nextConfig: NextConfig = {
	...(isDeployBuild && { output: "standalone" }),

	experimental: {
		// Two root layouts, `(site)` and `(platform)`, leave Next no single layout to build an ordinary 404 from, so a URL that matches nothing got the framework's unstyled default. This turns on `app/global-not-found.tsx`.
		globalNotFound: true,
	},

	/**
	 * Security headers for every route, including the ones the proxy matcher excludes – the handoff page at `/r/<token>`, the integration and upload routes. The proxy sets the same set for the pages it handles; duplicates are harmless and this is the one that covers the gaps.
	 */
	headers() {
		return [
			{
				headers: [
					{ key: "X-Frame-Options", value: "DENY" },
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
					{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
					{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
					{ key: "Content-Security-Policy", value: contentSecurityPolicy() },
				],
				source: "/:path*",
			},
		]
	},

	images: {
		/**
		 * AVIF first, WebP behind it.
		 *
		 * The default is WebP alone, and this page's artwork is the content type that punishes hardest: flat illustration with broad even fields and hard edges, where WebP spends its bitrate on ringing and banding. Measured on `getfunding.png` at the 640px a 1x screen fetches, against the same frame encoded losslessly: WebP q75 lands 35.8 dB in 28 KB, AVIF q75 lands 45.1 dB in 27 KB. Nine and a half decibels for a kilobyte less.
		 *
		 * Order matters -- the first entry the browser's `Accept` header matches is the one served -- and anything that supports neither is handed the original PNG, so there is nothing to guard.
		 */
		formats: ["image/avif", "image/webp"],

		/**
		 * 75 is the default and the only value allowed unless it is listed here: Next 16 made this an allowlist, and a `quality` prop outside it is silently coerced to the nearest entry rather than erroring. So 90 has to be declared before any component can ask for it.
		 *
		 * The artwork asks for 90, which is another 4.6 dB on top of the format change (49.7 dB against 45.1) for 41 KB against 27. Everything else stays at 75.
		 */
		qualities: [75, 90],

		remotePatterns: [
			{ hostname: "*.slack-edge.com", protocol: "https" },
			{ hostname: "cdn.hackclub.com", protocol: "https" },
			// The R2 public host. A URL whose hostname is not listed here renders as a broken image with no console error, so keep this in sync with S3_PUBLIC_URL.
			...(process.env.NEXT_PUBLIC_UPLOAD_HOST
				? [{ hostname: process.env.NEXT_PUBLIC_UPLOAD_HOST, protocol: "https" as const }]
				: []),
		],
	},
	poweredByHeader: false,
	reactCompiler: true,
	reactStrictMode: true,

	/**
	 * Bundles `pg` instead of leaving it as a server external. Turbopack loads externals through content-hashed aliases (`pg-<hash>`) that it symlinks into `.next/dev/node_modules` during the first compile, and Bun caches the first failed lookup for the life of the process – so the alias is written after Bun has already missed it, and every later import 500s with `Cannot find package 'pg-<hash>'` until the dev server restarts. Node re-resolves and is not affected. Remove this once Bun fixes the negative cache (oven-sh/bun#25370).
	 */
	transpilePackages: ["pg"],
}

export default nextConfig
