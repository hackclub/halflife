/**
 * The schema's enums, as values rather than types.
 *
 * Prisma 8 has no generated `enums.ts`: the contract knows each enum as a `valueSet`, and `db.nativeEnums` exposes it as `{ members, names, values }` rather than the `Phase.DESIGN` shape the app reads. This module keeps that shape for one import that works on both sides of the client boundary, since the contract runtime is a server dependency.
 *
 * Generated from `prisma/contract.prisma` by `scripts/generate-enums.ts` – run `bun run db:generate` after changing the schema. The `satisfies` check fails typecheck if this file and the contract disagree.
 */
import type { Contract } from "@/app/generated/prisma8/contract.d"

// A value and a type of the same name are the whole point of this module: call sites read `Phase.DESIGN` and annotate `: Phase` from one import, as they did with the generated file. Declaration merging is legal TypeScript, so the duplicate-declaration rule is off for the emitted names.
// oxlint-disable eslint/no-redeclare

type ValueSets = Contract["storage"]["namespaces"]["public"]["entries"]["valueSet"]

type Members<N extends keyof ValueSets> = ValueSets[N] extends { readonly values: readonly (infer V extends string)[] }
	? V
	: never

export const AuditAction = {
	ADMIN_ADJUST_CREDIT: "ADMIN_ADJUST_CREDIT",
	ADMIN_CHANGE_EMAIL: "ADMIN_CHANGE_EMAIL",
	ADMIN_CREATE_PROGRAM_EVENT: "ADMIN_CREATE_PROGRAM_EVENT",
	ADMIN_CREATE_SHOP_ITEM: "ADMIN_CREATE_SHOP_ITEM",
	ADMIN_CREATE_SHOP_REGION: "ADMIN_CREATE_SHOP_REGION",
	ADMIN_DELETE_PROGRAM_EVENT: "ADMIN_DELETE_PROGRAM_EVENT",
	ADMIN_DELETE_PROJECT: "ADMIN_DELETE_PROJECT",
	ADMIN_DISMISS_REPORT: "ADMIN_DISMISS_REPORT",
	ADMIN_FLAG_FRAUD: "ADMIN_FLAG_FRAUD",
	ADMIN_FULFILL_ORDER: "ADMIN_FULFILL_ORDER",
	ADMIN_GRANT_EXTENSION: "ADMIN_GRANT_EXTENSION",
	ADMIN_GRANT_ROLE: "ADMIN_GRANT_ROLE",
	ADMIN_HIDE_COMMENT: "ADMIN_HIDE_COMMENT",
	ADMIN_HIDE_POST: "ADMIN_HIDE_POST",
	ADMIN_IMPORT_AIRTABLE_PROJECT: "ADMIN_IMPORT_AIRTABLE_PROJECT",
	ADMIN_MOVE_PROJECT: "ADMIN_MOVE_PROJECT",
	ADMIN_PIN_POST: "ADMIN_PIN_POST",
	ADMIN_REJECT_ORDER: "ADMIN_REJECT_ORDER",
	ADMIN_REOPEN_PHASE: "ADMIN_REOPEN_PHASE",
	ADMIN_RESET_ONBOARDING: "ADMIN_RESET_ONBOARDING",
	ADMIN_RESOLVE_DISPUTE: "ADMIN_RESOLVE_DISPUTE",
	ADMIN_RESOLVE_REPORT: "ADMIN_RESOLVE_REPORT",
	ADMIN_RESTORE_POST: "ADMIN_RESTORE_POST",
	ADMIN_RESTORE_PROJECT: "ADMIN_RESTORE_PROJECT",
	ADMIN_RETIRE_SHOP_ITEM: "ADMIN_RETIRE_SHOP_ITEM",
	ADMIN_REVOKE_ROLE: "ADMIN_REVOKE_ROLE",
	ADMIN_SEND_GRANT: "ADMIN_SEND_GRANT",
	ADMIN_SET_REGION_PRICE: "ADMIN_SET_REGION_PRICE",
	ADMIN_UNAPPROVE_PHASE: "ADMIN_UNAPPROVE_PHASE",
	ADMIN_UNFLAG_FRAUD: "ADMIN_UNFLAG_FRAUD",
	ADMIN_UPDATE_ORDER_FULFILLMENT: "ADMIN_UPDATE_ORDER_FULFILLMENT",
	ADMIN_UPDATE_PROGRAM_EVENT: "ADMIN_UPDATE_PROGRAM_EVENT",
	ADMIN_UPDATE_PROGRAM_SETTINGS: "ADMIN_UPDATE_PROGRAM_SETTINGS",
	ADMIN_UPDATE_SHOP_ITEM: "ADMIN_UPDATE_SHOP_ITEM",
	ADMIN_UPDATE_SHOP_REGION: "ADMIN_UPDATE_SHOP_REGION",
	AIRTABLE_SYNC_FAILURE: "AIRTABLE_SYNC_FAILURE",
	AIRTABLE_SYNC_SUCCESS: "AIRTABLE_SYNC_SUCCESS",
	ARI_SYNC_FAILURE: "ARI_SYNC_FAILURE",
	ARI_SYNC_SUCCESS: "ARI_SYNC_SUCCESS",
	ARI_WEBHOOK_APPLIED: "ARI_WEBHOOK_APPLIED",
	ARI_WEBHOOK_IGNORED: "ARI_WEBHOOK_IGNORED",
	NOTIFICATION_FAILURE: "NOTIFICATION_FAILURE",
	PRINTER_QUALIFIED: "PRINTER_QUALIFIED",
	PRINTER_REVOKED: "PRINTER_REVOKED",
	PRINTER_STATUS_CHANGE: "PRINTER_STATUS_CHANGE",
	REPO_SYNC_FAILURE: "REPO_SYNC_FAILURE",
	REPO_SYNC_SUCCESS: "REPO_SYNC_SUCCESS",
	REVIEW_APPROVE: "REVIEW_APPROVE",
	REVIEW_APPROVE_HOURS: "REVIEW_APPROVE_HOURS",
	REVIEW_CLAIM: "REVIEW_CLAIM",
	REVIEW_REJECT: "REVIEW_REJECT",
	REVIEW_RELEASE: "REVIEW_RELEASE",
	REVIEW_RETURN: "REVIEW_RETURN",
	SYSTEM_CLAIM_SWEEP: "SYSTEM_CLAIM_SWEEP",
	SYSTEM_HACKATIME_SYNC: "SYSTEM_HACKATIME_SYNC",
	SYSTEM_RSVP_DRAIN: "SYSTEM_RSVP_DRAIN",
	USER_ADVANCE_ONBOARDING: "USER_ADVANCE_ONBOARDING",
	USER_COMMENT_POST: "USER_COMMENT_POST",
	USER_COMPLETE_ONBOARDING: "USER_COMPLETE_ONBOARDING",
	USER_CREATE_POST: "USER_CREATE_POST",
	USER_CREATE_POST_FAILED: "USER_CREATE_POST_FAILED",
	USER_CREATE_REPORT: "USER_CREATE_REPORT",
	USER_CREATE_SESSION: "USER_CREATE_SESSION",
	USER_DELETE_COMMENT: "USER_DELETE_COMMENT",
	USER_DELETE_POST: "USER_DELETE_POST",
	USER_DELETE_PROJECT: "USER_DELETE_PROJECT",
	USER_DELETE_SESSION: "USER_DELETE_SESSION",
	USER_DISPUTE_REVIEW: "USER_DISPUTE_REVIEW",
	USER_HANDOFF_UPLOAD: "USER_HANDOFF_UPLOAD",
	USER_LINK_HACKATIME: "USER_LINK_HACKATIME",
	USER_PLACE_ORDER: "USER_PLACE_ORDER",
	USER_SET_PARTICIPANT_GOAL: "USER_SET_PARTICIPANT_GOAL",
	USER_SET_PRINTER_GOAL: "USER_SET_PRINTER_GOAL",
	USER_SUBMIT_PHASE: "USER_SUBMIT_PHASE",
	USER_UNLINK_HACKATIME: "USER_UNLINK_HACKATIME",
	USER_UNSUBMIT_PHASE: "USER_UNSUBMIT_PHASE",
	USER_UPDATE_PROJECT: "USER_UPDATE_PROJECT",
	USER_UPDATE_REPO_SYNC: "USER_UPDATE_REPO_SYNC",
	USER_UPDATE_SESSION: "USER_UPDATE_SESSION",
} as const satisfies { [K in Members<"AuditAction">]: K }

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction]

export const CoinBucket = {
	BANKED: "BANKED",
	SPENDABLE: "SPENDABLE",
} as const satisfies { [K in Members<"CoinBucket">]: K }

export type CoinBucket = (typeof CoinBucket)[keyof typeof CoinBucket]

export const EventColour = {
	CORAL: "CORAL",
	GOLD: "GOLD",
	SKY: "SKY",
	SLATE: "SLATE",
	TEAL: "TEAL",
	VIOLET: "VIOLET",
} as const satisfies { [K in Members<"EventColour">]: K }

export type EventColour = (typeof EventColour)[keyof typeof EventColour]

export const HardwareExperience = {
	A_GOOD_AMOUNT: "A_GOOD_AMOUNT",
	A_LITTLE: "A_LITTLE",
	FIRST_TIME: "FIRST_TIME",
	ITS_LIFE: "ITS_LIFE",
} as const satisfies { [K in Members<"HardwareExperience">]: K }

export type HardwareExperience = (typeof HardwareExperience)[keyof typeof HardwareExperience]

export const HoursSource = {
	HACKATIME_TRACKED: "HACKATIME_TRACKED",
	MANUAL: "MANUAL",
} as const satisfies { [K in Members<"HoursSource">]: K }

export type HoursSource = (typeof HoursSource)[keyof typeof HoursSource]

export const LedgerKind = {
	ADMIN_ADJUSTMENT: "ADMIN_ADJUSTMENT",
	BOM_SAVINGS: "BOM_SAVINGS",
	BUILD_BANKED_HOURS: "BUILD_BANKED_HOURS",
	BUILD_HOURS: "BUILD_HOURS",
	DESIGN_BANKED_HOURS: "DESIGN_BANKED_HOURS",
	DESIGN_EXCESS_HOURS: "DESIGN_EXCESS_HOURS",
	PARTS_TOP_UP: "PARTS_TOP_UP",
	REVIEWER_PAYMENT: "REVIEWER_PAYMENT",
	SHOP_PURCHASE: "SHOP_PURCHASE",
	SHOP_REFUND: "SHOP_REFUND",
	THEME_COMPLETION_BONUS: "THEME_COMPLETION_BONUS",
} as const satisfies { [K in Members<"LedgerKind">]: K }

export type LedgerKind = (typeof LedgerKind)[keyof typeof LedgerKind]

export const MediaType = {
	IMAGE: "IMAGE",
	VIDEO: "VIDEO",
} as const satisfies { [K in Members<"MediaType">]: K }

export type MediaType = (typeof MediaType)[keyof typeof MediaType]

export const ParticipantGoal = {
	FULL_FUNDING: "FULL_FUNDING",
	PARTIAL_FUNDING: "PARTIAL_FUNDING",
	PRINTER: "PRINTER",
} as const satisfies { [K in Members<"ParticipantGoal">]: K }

export type ParticipantGoal = (typeof ParticipantGoal)[keyof typeof ParticipantGoal]

export const Phase = {
	BUILD: "BUILD",
	DESIGN: "DESIGN",
} as const satisfies { [K in Members<"Phase">]: K }

export type Phase = (typeof Phase)[keyof typeof Phase]

export const PhaseStatus = {
	approved: "approved",
	draft: "draft",
	in_review: "in_review",
	rejected: "rejected",
	update_requested: "update_requested",
} as const satisfies { [K in Members<"PhaseStatus">]: K }

export type PhaseStatus = (typeof PhaseStatus)[keyof typeof PhaseStatus]

export const PostKind = {
	ANNOUNCEMENT: "ANNOUNCEMENT",
	FREEFORM: "FREEFORM",
	IDEA: "IDEA",
	PROGRESS: "PROGRESS",
	SUBMISSION: "SUBMISSION",
} as const satisfies { [K in Members<"PostKind">]: K }

export type PostKind = (typeof PostKind)[keyof typeof PostKind]

export const PostStatus = {
	HIDDEN: "HIDDEN",
	PROCESSING: "PROCESSING",
	PUBLISHED: "PUBLISHED",
	REMOVED: "REMOVED",
} as const satisfies { [K in Members<"PostStatus">]: K }

export type PostStatus = (typeof PostStatus)[keyof typeof PostStatus]

export const PrinterAwardStatus = {
	ADDRESS_LOCKED: "ADDRESS_LOCKED",
	DELIVERED: "DELIVERED",
	PACKING: "PACKING",
	QUALIFIED: "QUALIFIED",
	REVOKED: "REVOKED",
	SHIPPED: "SHIPPED",
} as const satisfies { [K in Members<"PrinterAwardStatus">]: K }

export type PrinterAwardStatus = (typeof PrinterAwardStatus)[keyof typeof PrinterAwardStatus]

export const PublicReelPlatform = {
	INSTAGRAM: "INSTAGRAM",
	TIKTOK: "TIKTOK",
	X: "X",
	YOUTUBE: "YOUTUBE",
} as const satisfies { [K in Members<"PublicReelPlatform">]: K }

export type PublicReelPlatform = (typeof PublicReelPlatform)[keyof typeof PublicReelPlatform]

export const ReportReason = {
	EXCESSIVE_AI_USE: "EXCESSIVE_AI_USE",
	MISCONDUCT: "MISCONDUCT",
	OTHER: "OTHER",
	SPAM: "SPAM",
} as const satisfies { [K in Members<"ReportReason">]: K }

export type ReportReason = (typeof ReportReason)[keyof typeof ReportReason]

export const ReportStatus = {
	DISMISSED: "DISMISSED",
	OPEN: "OPEN",
	RESOLVED: "RESOLVED",
} as const satisfies { [K in Members<"ReportStatus">]: K }

export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus]

export const ReportTarget = {
	DEVLOG: "DEVLOG",
	PROJECT: "PROJECT",
	REEL: "REEL",
	REEL_COMMENT: "REEL_COMMENT",
	USER: "USER",
} as const satisfies { [K in Members<"ReportTarget">]: K }

export type ReportTarget = (typeof ReportTarget)[keyof typeof ReportTarget]

export const ReviewDisputeOutcome = {
	stood: "stood",
	upheld: "upheld",
} as const satisfies { [K in Members<"ReviewDisputeOutcome">]: K }

export type ReviewDisputeOutcome = (typeof ReviewDisputeOutcome)[keyof typeof ReviewDisputeOutcome]

export const ReviewPass = {
	FINAL: "FINAL",
	FIRST: "FIRST",
} as const satisfies { [K in Members<"ReviewPass">]: K }

export type ReviewPass = (typeof ReviewPass)[keyof typeof ReviewPass]

export const ReviewResult = {
	APPROVED: "APPROVED",
	REJECTED: "REJECTED",
	RETURNED: "RETURNED",
} as const satisfies { [K in Members<"ReviewResult">]: K }

export type ReviewResult = (typeof ReviewResult)[keyof typeof ReviewResult]

export const Role = {
	ADMIN: "ADMIN",
	AUDITOR: "AUDITOR",
	FULFILLER: "FULFILLER",
	REVIEWER: "REVIEWER",
} as const satisfies { [K in Members<"Role">]: K }

export type Role = (typeof Role)[keyof typeof Role]

export const ShopFulfillmentMethod = {
	BULK_TO_HQ: "BULK_TO_HQ",
	DIRECT_SHIP: "DIRECT_SHIP",
} as const satisfies { [K in Members<"ShopFulfillmentMethod">]: K }

export type ShopFulfillmentMethod = (typeof ShopFulfillmentMethod)[keyof typeof ShopFulfillmentMethod]

export const ShopFulfillmentStage = {
	CANCELLED: "CANCELLED",
	ORDERED_TO_HQ: "ORDERED_TO_HQ",
	SENT_FOR_DELIVERY: "SENT_FOR_DELIVERY",
	UNFULFILLED: "UNFULFILLED",
} as const satisfies { [K in Members<"ShopFulfillmentStage">]: K }

export type ShopFulfillmentStage = (typeof ShopFulfillmentStage)[keyof typeof ShopFulfillmentStage]

export const ShopItemCategory = {
	CONSUMABLE: "CONSUMABLE",
	MISC: "MISC",
	PRINTER: "PRINTER",
	PRINTER_UPGRADE: "PRINTER_UPGRADE",
} as const satisfies { [K in Members<"ShopItemCategory">]: K }

export type ShopItemCategory = (typeof ShopItemCategory)[keyof typeof ShopItemCategory]

export const ShopOrderStatus = {
	CANCELLED: "CANCELLED",
	FULFILLED: "FULFILLED",
	ON_HOLD: "ON_HOLD",
	PENDING: "PENDING",
	REJECTED: "REJECTED",
} as const satisfies { [K in Members<"ShopOrderStatus">]: K }

export type ShopOrderStatus = (typeof ShopOrderStatus)[keyof typeof ShopOrderStatus]

export const Theme = {
	BREADBOARD_COMPUTER: "BREADBOARD_COMPUTER",
	CAD: "CAD",
	DISPLAYS: "DISPLAYS",
	PCB: "PCB",
	SYNTH: "SYNTH",
	WARMUP: "WARMUP",
} as const satisfies { [K in Members<"Theme">]: K }

export type Theme = (typeof Theme)[keyof typeof Theme]
