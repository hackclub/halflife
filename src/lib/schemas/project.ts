import { z } from "zod"
import { boundedText, httpsUrl, phaseSchema } from "@/lib/schemas/common"

const projectUpdateSchema = z
	.object({
		artifactLinks: z
			.array(z.object({ label: boundedText(80, 1), url: httpsUrl }))
			.max(10)
			.optional(),
		coverImageKey: z.string().max(500).nullable().optional(),
		/**
		 * Not blankable. A project with no description is a project a reviewer has nothing to read, and the submit gate already refuses one below its floor – so the blank has to be refused here too, where the details are written.
		 */
		description: boundedText(4000, 1).optional(),
		githubRepo: httpsUrl.nullable().optional(),
		/**
		 * The tier the participant is ASKING for. Never the assigned one: that is a reviewer's decision at design approval, because it is parts money.
		 */
		requestedTier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
		/**
		 * Taking one of the week's starter projects, or null to go back to your own idea. The route checks it is one this person is offered.
		 */
		starterProjectId: z.string().trim().min(1).max(64).nullable().optional(),
		title: boundedText(120, 1).optional(),
	})
	.strict()

const submitSchema = z
	.object({
		/** R2 keys for evidence handed in with the submission. */
		attachmentKeys: z.array(z.string().max(500)).max(10).default([]),
		/**
		 * The maker ticked the box saying they want no parts funding for this project. Design only: a build carries no parts money, so the route refuses it there rather than recording a meaningless flag.
		 */
		fundingDeclined: z.boolean().default(false),
		notes: boundedText(4000).optional(),
		/**
		 * The maker ticked the box saying they know a cart past the tier's funding is only partly funded and they will cover the rest.
		 *
		 * An assertion, not permission: the route works out from the database whether the cart is actually over, and ignores this on one that is not, so a stale tick left over from a bigger cart cannot get a small one through.
		 */
		partialFundingAccepted: z.boolean().default(false),
		phase: phaseSchema,
	})
	.strict()

const unsubmitSchema = z.object({ phase: phaseSchema }).strict()

/**
 * A maker asking for a second look at a decided review.
 *
 * The note is required: a dispute that does not say what is wrong is one no one can act on.
 */
const disputeSchema = z
	.object({
		note: boundedText(2000, 10),
		phase: phaseSchema,
	})
	.strict()

const hackatimeLinkSchema = z
	.object({
		hackatimeProject: boundedText(200, 1),
		phase: phaseSchema.default("BUILD"),
	})
	.strict()

/** One line of a bill of materials, as the maker writes it. */
const bomItemSchema = z
	.object({
		link: httpsUrl,
		name: boundedText(120, 1),
		// Every field is required: a reviewer prices the tier from this list, and a line without a vendor, a link or a price is one they cannot check.
		purpose: boundedText(200, 1),
		quantity: z.number().int().min(1).max(10_000),
		unitCostUsd: z.number().positive().max(10_000),
		vendor: boundedText(80, 1),
	})
	.strict()

const bomItemUpdateSchema = bomItemSchema.partial().strict()

type BomItemInput = z.infer<typeof bomItemSchema>

/** A bill of materials' tax and shipping total. Null clears it back to zero. */
const bomExtrasSchema = z.object({ taxShippingUsd: z.number().min(0).max(10_000).nullable() }).strict()

/**
 * Reading a project's BOM CSV into its parts list.
 *
 * `apply` false is a preview: read the repo and report what would land. `apply` true writes, and `replace` says whether that means the whole list or an addition to it – the caller is shown the count first and chooses. Both default false, so an empty body is the harmless preview.
 */
const bomImportSchema = z
	.object({
		apply: z.boolean().default(false),
		replace: z.boolean().default(false),
	})
	.strict()

/**
 * A repo URL a forge picker may have offered: `github.com/owner/name`, or `gitlab.com/group/sub/repo` for GitLab's nested groups. Two to four path segments, an optional scheme, an optional trailing slash.
 *
 * This is the outer bound only. `parseRepoRef` narrows it further (known host, safe segments, no traversal) and `enableRepoSync` resolves it against the forge it names, so a string that slips past this still cannot point the sync at a repo the caller never picked without the token having to be able to push there.
 */
const REPO_URL_RE = /^(https?:\/\/)?[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){1,3}\/?$/

/**
 * Repo sync, switched per project.
 *
 * `repo` is the full URL of a repo the picker offered, not a bare slug: the forge it lives on has to stay inferable from the stored value, and a host-less slug cannot say which service it means.
 */
const repoSyncSettingsSchema = z
	.object({
		enabled: z.boolean(),
		/** Required when turning it on, ignored when turning it off. */
		repo: z.string().trim().regex(REPO_URL_RE, "Pick a repository to sync to").max(300).optional(),
	})
	.strict()

export {
	type BomItemInput,
	bomExtrasSchema,
	bomImportSchema,
	bomItemSchema,
	bomItemUpdateSchema,
	disputeSchema,
	hackatimeLinkSchema,
	projectUpdateSchema,
	REPO_URL_RE,
	repoSyncSettingsSchema,
	submitSchema,
	unsubmitSchema,
}
