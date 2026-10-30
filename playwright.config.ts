import { defineConfig, devices } from "@playwright/test"
import { e2eBaseUrl, webServerEnv } from "./e2e/env"

/**
 * Browser tests run against their own Next server on :3100 and their own database.
 *
 * `reuseExistingServer` is off on purpose. Reusing a running dev server would mean a different database and probably a different auth secret, and the failure would look like a broken guard rather than a misconfigured run.
 */
export default defineConfig({
	expect: { timeout: 10_000 },
	fullyParallel: false,
	outputDir: "test-results",
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
	retries: process.env.CI ? 2 : 0,
	testDir: "e2e",
	testMatch: "**/*.spec.ts",
	timeout: 60_000,
	use: {
		baseURL: e2eBaseUrl,
		screenshot: "only-on-failure",
		trace: "on-first-retry",
		video: "retain-on-failure",
	},
	webServer: {
		// `--bun` runs `next start` / `next dev` on Bun rather than the `node` its shebang names, so the suite exercises the same runtime as the container image. The Playwright CLI is on Bun too: the `test:e2e*` scripts use `bun --bun x`.
		command: process.env.CI ? "bun --bun run start:e2e" : "bun --bun run dev:e2e",
		env: webServerEnv,
		reuseExistingServer: false,
		stderr: "pipe",
		stdout: "pipe",
		timeout: 180_000,
		url: `${e2eBaseUrl}/api/health`,
	},
	workers: 1,
})
