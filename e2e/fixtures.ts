import { type BrowserContext, test as base, type Page } from "@playwright/test"
import { sessionCookie } from "./auth"
import { closeDb, type SeededUser, type SeedUserOptions, seedUser } from "./db"

export interface OpenSession {
	page: Page
	user: SeededUser
}

interface E2eFixtures {
	admin: Page
	openAs(options?: SeedUserOptions): Promise<OpenSession>
	participant: Page
	reviewer: Page
}

interface E2eWorkerFixtures {
	dbLifecycle: undefined
}

/**
 * Keep browser traffic on the loopback interface.
 *
 * The landing page loads Plausible and remote artwork; neither belongs in a test run, and a CI runner should not depend on either. Aborting is enough: the page degrades exactly as it would behind a blocked network, and no assertion here is about an image.
 */
async function guardBrowserNetwork(context: BrowserContext): Promise<void> {
	const allowed = new Set(["localhost", "127.0.0.1", "[::1]"])

	await context.route("**", route => {
		const url = new URL(route.request().url())
		if (allowed.has(url.hostname)) return route.continue()
		return route.abort()
	})
}

/**
 * Every test gets its own user and its own browser context.
 *
 * The context is created with the session cookie already present, so the first navigation is a signed-in one: no sign-in step, no shared storage state file, and no cookie leaking from one test to the next.
 */
export const test = base.extend<E2eFixtures, E2eWorkerFixtures>({
	admin: async ({ openAs }, provide) => {
		const { page } = await openAs({ onboarding: "complete", role: "ADMIN" })
		await provide(page)
	},
	dbLifecycle: [
		async ({}, provide) => {
			await provide(undefined)
			await closeDb()
		},
		{ auto: true, scope: "worker" },
	],

	openAs: async ({ browser, baseURL }, provide) => {
		if (!baseURL) throw new Error("Playwright baseURL is not configured")

		const contexts: BrowserContext[] = []
		await provide(async options => {
			const user = await seedUser(options)
			const context = await browser.newContext({
				baseURL,
				storageState: { cookies: [sessionCookie(user.token)], origins: [] },
			})
			await guardBrowserNetwork(context)
			contexts.push(context)

			const page = await context.newPage()
			// Prove the cookie before the test does any work. A rejected session would otherwise look like a guard bug in whatever page the test opened first.
			const response = await context.request.get("/api/auth/get-session")
			const session = (await response.json()) as { user?: { id?: string } }
			if (session.user?.id !== user.id)
				throw new Error(
					`The seeded session was not accepted by ${baseURL}. Check BETTER_AUTH_SECRET and e2e/auth.ts's cookie name against better-auth.`,
				)

			return { page, user }
		})

		for (const context of contexts) await context.close()
	},

	page: async ({ page }, provide) => {
		await guardBrowserNetwork(page.context())
		await provide(page)
	},

	participant: async ({ openAs }, provide) => {
		const { page } = await openAs({ onboarding: "complete" })
		await provide(page)
	},

	reviewer: async ({ openAs }, provide) => {
		const { page } = await openAs({ onboarding: "complete", role: "REVIEWER" })
		await provide(page)
	},
})

export { expect } from "@playwright/test"
