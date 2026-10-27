import { describe, expect, test } from "bun:test"
import { Phase } from "@/lib/enums"
import {
	bomExtrasSchema,
	bomImportSchema,
	bomItemSchema,
	bomItemUpdateSchema,
	disputeSchema,
	hackatimeLinkSchema,
	projectRepoUrl,
	projectUpdateSchema,
	REPO_URL_RE,
	repoSyncSettingsSchema,
	submitSchema,
	unsubmitSchema,
} from "@/lib/schemas/project"

describe("projectRepoUrl / REPO_URL_RE", () => {
	test("takes any http(s) host except Onshape", () => {
		expect(projectRepoUrl.safeParse("https://github.com/me/repo").success).toBe(true)
		expect(projectRepoUrl.safeParse("https://codeberg.org/me/repo").success).toBe(true)
		expect(projectRepoUrl.safeParse("https://cad.onshape.com/documents/abc").success).toBe(false)
		expect(projectRepoUrl.safeParse("ftp://example.com/repo").success).toBe(false)
	})

	test("the picker regex spans two to four segments with an optional scheme", () => {
		expect(REPO_URL_RE.test("github.com/owner/name")).toBe(true)
		expect(REPO_URL_RE.test("https://gitlab.com/group/sub/repo")).toBe(true)
		expect(REPO_URL_RE.test("github.com/owner")).toBe(false)
		expect(REPO_URL_RE.test("notaurl")).toBe(false)
	})
})

describe("projectUpdateSchema", () => {
	test("accepts partial updates and stays strict", () => {
		expect(projectUpdateSchema.safeParse({ title: "New title" }).success).toBe(true)
		expect(projectUpdateSchema.safeParse({}).success).toBe(true)
		expect(projectUpdateSchema.safeParse({ description: "" }).success).toBe(false)
		expect(projectUpdateSchema.safeParse({ extra: 1 }).success).toBe(false)
		expect(projectUpdateSchema.safeParse({ githubRepo: "https://github.com/me/repo" }).success).toBe(true)
		expect(projectUpdateSchema.safeParse({ requestedTier: 2 }).success).toBe(true)
		expect(projectUpdateSchema.safeParse({ requestedTier: 5 }).success).toBe(false)
	})
})

describe("submitSchema / unsubmitSchema / disputeSchema", () => {
	test("submissions default to a plain hand-in", () => {
		const parsed = submitSchema.safeParse({ phase: Phase.DESIGN })
		expect(parsed.success).toBe(true)
		if (parsed.success)
			expect(parsed.data).toMatchObject({
				attachmentKeys: [],
				fundingDeclined: false,
				noMicrocontroller: false,
				partialFundingAccepted: false,
			})
	})

	test("disputes need a real note", () => {
		expect(disputeSchema.safeParse({ note: "short", phase: Phase.DESIGN }).success).toBe(false)
		expect(disputeSchema.safeParse({ note: "This is wrong because…", phase: "nope" }).success).toBe(false)
		expect(disputeSchema.safeParse({ note: "This is wrong because…", phase: Phase.DESIGN }).success).toBe(true)
		expect(unsubmitSchema.safeParse({ phase: Phase.BUILD }).success).toBe(true)
	})
})

describe("hackatimeLinkSchema", () => {
	test("links default to the build phase", () => {
		const parsed = hackatimeLinkSchema.safeParse({ hackatimeProject: "proj" })
		expect(parsed.success).toBe(true)
		if (parsed.success) expect(parsed.data.phase).toBe(Phase.BUILD)
		expect(hackatimeLinkSchema.safeParse({ hackatimeProject: "" }).success).toBe(false)
	})
})

describe("bomItemSchema / bomItemUpdateSchema / bomExtrasSchema / bomImportSchema", () => {
	const validItem = {
		link: "https://example.com/part",
		name: "10k resistor",
		purpose: "Pull-ups",
		quantity: 10,
		unitCostUsd: 0.05,
		vendor: "DigiKey",
	}

	test("a line needs every field", () => {
		expect(bomItemSchema.safeParse(validItem).success).toBe(true)
		expect(bomItemSchema.safeParse({ ...validItem, quantity: 0 }).success).toBe(false)
		expect(bomItemSchema.safeParse({ ...validItem, unitCostUsd: -1 }).success).toBe(false)
		expect(bomItemUpdateSchema.safeParse({ quantity: 5 }).success).toBe(true)
		expect(bomItemUpdateSchema.safeParse({ quantity: 0 }).success).toBe(false)
	})

	test("extras and imports default to harmless", () => {
		const extras = bomExtrasSchema.safeParse({ taxShippingUsd: null })
		expect(extras.success).toBe(true)
		expect(bomExtrasSchema.safeParse({ taxShippingUsd: -1 }).success).toBe(false)
		const preview = bomImportSchema.safeParse({})
		expect(preview.success).toBe(true)
		if (preview.success) expect(preview.data).toEqual({ apply: false, replace: false })
	})
})

describe("repoSyncSettingsSchema", () => {
	test("switching sync needs a picked repo when turning on", () => {
		expect(repoSyncSettingsSchema.safeParse({ enabled: false }).success).toBe(true)
		expect(repoSyncSettingsSchema.safeParse({ enabled: true, repo: "github.com/me/repo" }).success).toBe(true)
		expect(repoSyncSettingsSchema.safeParse({ enabled: true, repo: "notaurl" }).success).toBe(false)
		expect(repoSyncSettingsSchema.safeParse({ enabled: true }).success).toBe(true)
	})
})
