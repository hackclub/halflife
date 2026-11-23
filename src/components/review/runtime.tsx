"use client"

import { useRouter } from "next/navigation"
import { createContext, type ReactNode, useContext, useMemo } from "react"
import {
	adjustHours,
	claim,
	closeDispute,
	type DecisionBody,
	decide,
	overrideDecision,
	releaseQuietly,
	replyToDispute,
	saveSessionHours,
	sendDisputeBack,
	takeBack,
} from "@/components/review/api"
import { uncheckedRoute } from "@/lib/routes"

/**
 * What the review screen does that needs the server: its writes and its moves between pages.
 *
 * Online, this is the API in `api.ts` and the Next router, unchanged. The offline page (`/reviews/offline`) provides its own, which keeps writes in the outbox and moves between downloaded submissions without asking the server for anything, so the same screen works with no connection.
 */
export interface ReviewRuntime {
	adjustHours(
		submissionId: string,
		entries: { comments: string; hoursApproved: number; id: string }[],
	): Promise<{ approvedHours: number; unrecovered: number }>
	claim(submissionId: string): Promise<{ expiresAt: string }>
	closeDispute(disputeId: string): Promise<unknown>
	decide(submissionId: string, body: DecisionBody): Promise<unknown>
	/** The address a picture or video is played from: itself online, the downloaded copy offline. */
	mediaSrc(url: string): string
	/** Whether this runtime is the offline one, for the few places that word things differently. */
	offline: boolean
	overrideDecision(
		projectId: string,
		body: { action: "unapprove" | "reopen"; phase: "DESIGN" | "BUILD"; reason: string },
	): Promise<unknown>
	push(href: string): void
	refresh(): void
	releaseQuietly(submissionId: string, keepalive?: boolean): Promise<void>
	replace(href: string): void
	replyToDispute(disputeId: string, body: string): Promise<unknown>
	saveSessionHours(
		entry: { comments: string; hoursApproved: number; id: string },
		keepalive?: boolean,
	): Promise<unknown>
	sendDisputeBack(disputeId: string): Promise<unknown>
	takeBack(submissionId: string): Promise<{ feedback: string }>
}

const ReviewRuntimeContext = createContext<ReviewRuntime | null>(null)

export function ReviewRuntimeProvider({ children, runtime }: { children: ReactNode; runtime: ReviewRuntime }) {
	return <ReviewRuntimeContext value={runtime}>{children}</ReviewRuntimeContext>
}

const sameUrl = (url: string): string => url

/** The runtime the review screen runs on: the offline one inside `/reviews/offline`, the server everywhere else. */
export function useReviewRuntime(): ReviewRuntime {
	const provided = useContext(ReviewRuntimeContext)
	const router = useRouter()
	const fallback = useMemo<ReviewRuntime>(
		() =>
			Object.freeze({
				adjustHours,
				claim,
				closeDispute,
				decide,
				mediaSrc: sameUrl,
				offline: false,
				overrideDecision,
				push: (href: string) => router.push(uncheckedRoute(href)),
				refresh: () => router.refresh(),
				releaseQuietly,
				replace: (href: string) => router.replace(uncheckedRoute(href)),
				replyToDispute,
				saveSessionHours,
				sendDisputeBack,
				takeBack,
			}),
		[router],
	)
	return provided ?? fallback
}

/** Just the media mapping, for components that only show pictures and videos. */
export const useMediaSrc = (): ((url: string) => string) => useReviewRuntime().mediaSrc
