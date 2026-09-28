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
     * The tier the participant is ASKING for. Never the assigned one: that is
     * a reviewer's decision at design approval, because it is parts money.
     */
    requestedTier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    /**
     * Taking one of the week's starter projects, or null to go back to your
     * own idea. The route checks it is one this person is offered.
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
  })
  .strict()

export const unsubmitSchema = z.object({ phase: phaseSchema }).strict()

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
    // Every field is required: a reviewer prices the tier from this list, and
    // a line without a vendor, a link or a price is one they cannot check.
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
