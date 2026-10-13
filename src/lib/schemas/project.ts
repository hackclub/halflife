import { z } from "zod"
import { boundedText, httpsUrl, phaseSchema } from "@/lib/schemas/common"

export const projectUpdateSchema = z
	.object({
		title: boundedText(120, 1).optional(),
		description: boundedText(4000).optional(),
		githubRepo: httpsUrl.nullable().optional(),
		coverImageKey: z.string().max(500).nullable().optional(),
		artifactLinks: z
			.array(z.object({ label: boundedText(80, 1), url: httpsUrl }))
			.max(10)
			.optional(),
		/**
		 * The tier the participant is ASKING for. Never the assigned one: that is a reviewer's decision at design approval, because it is parts money.
		 */
		requestedTier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
		/**
		 * Taking one of the week's starter projects, or null to go back to your own idea. The route checks it is one this person is offered.
		 */
		starterProjectId: z.string().trim().min(1).max(64).nullable().optional(),
	})
	.strict()

export const submitSchema = z
	.object({
		phase: phaseSchema,
		notes: boundedText(4000).optional(),
		/** R2 keys for evidence handed in with the submission. */
		attachmentKeys: z.array(z.string().max(500)).max(10).default([]),
		/**
		 * The maker ticked the box saying they know a cart past the tier's funding is only partly funded and they will cover the rest.
		 *
		 * An assertion, not permission: the route works out from the database whether the cart is actually over, and ignores this on one that is not, so a stale tick left over from a bigger cart cannot get a small one through.
		 */
		partialFundingAccepted: z.boolean().default(false),
	})
	.strict()

export const unsubmitSchema = z.object({ phase: phaseSchema }).strict()

/**
 * A maker asking for a second look at a decided review.
 *
 * The note is required: a dispute that does not say what is wrong is one no one can act on.
 */
export const disputeSchema = z
	.object({
		phase: phaseSchema,
		note: boundedText(2000, 10),
	})
	.strict()

export const hackatimeLinkSchema = z
	.object({
		hackatimeProject: boundedText(200, 1),
		phase: phaseSchema.default("BUILD"),
	})
	.strict()

export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>

/** One line of a bill of materials, as the maker writes it. */
export const bomItemSchema = z
	.object({
		name: boundedText(120, 1),
		// Every field is required: a reviewer prices the tier from this list, and a line without a vendor, a link or a price is one they cannot check.
		purpose: boundedText(200, 1),
		quantity: z.number().int().min(1).max(10_000),
		unitCostUsd: z.number().positive().max(10_000),
		vendor: boundedText(80, 1),
		link: httpsUrl,
	})
	.strict()

export const bomItemUpdateSchema = bomItemSchema.partial().strict()

export type BomItemInput = z.infer<typeof bomItemSchema>

/** A bill of materials' tax and shipping total. Null clears it back to zero. */
export const bomExtrasSchema = z.object({ taxShippingUsd: z.number().min(0).max(10_000).nullable() }).strict()

/**
 * Reading a project's BOM CSV into its parts list.
 *
 * `apply` false is a preview: read the repo and report what would land. `apply` true writes, and `replace` says whether that means the whole list or an addition to it – the caller is shown the count first and chooses. Both default false, so an empty body is the harmless preview.
 */
export const bomImportSchema = z
	.object({
		apply: z.boolean().default(false),
		replace: z.boolean().default(false),
	})
	.strict()

export type BomImportInput = z.infer<typeof bomImportSchema>

/**
 * A repo URL a forge picker may have offered: `github.com/owner/name`, or `gitlab.com/group/sub/repo` for GitLab's nested groups. Two to four path segments, an optional scheme, an optional trailing slash.
 *
 * This is the outer bound only. `parseRepoRef` narrows it further (known host, safe segments, no traversal) and `enableRepoSync` resolves it against the forge it names, so a string that slips past this still cannot point the sync at a repo the caller never picked without the token having to be able to push there.
 */
export const REPO_URL_RE = /^(https?:\/\/)?[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){1,3}\/?$/

/**
 * Repo sync, switched per project.
 *
 * `repo` is the full URL of a repo the picker offered, not a bare slug: the forge it lives on has to stay inferable from the stored value, and a host-less slug cannot say which service it means.
 */
export const repoSyncSettingsSchema = z
	.object({
		enabled: z.boolean(),
		/** Required when turning it on, ignored when turning it off. */
		repo: z.string().trim().regex(REPO_URL_RE, "Pick a repository to sync to").max(300).optional(),
	})
	.strict()

export type RepoSyncSettingsInput = z.infer<typeof repoSyncSettingsSchema>
