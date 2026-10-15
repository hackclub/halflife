"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect } from "react"
import {
	JournalModal,
	ProjectModal,
	PublicReelModal,
	ReelModal,
	SubmitModal,
	UnsubmitModal,
} from "@/components/platform/modals/CheckpointModals"
import { FirstCheckpoint } from "@/components/platform/modals/FirstCheckpoint"
import { GoalModal } from "@/components/platform/modals/GoalModal"
import { PLATFORM_HOME } from "@/lib/routes"
import { useStore } from "@/lib/store"
import { Cinematic } from "./Cinematic"
import { Spotlight } from "./Spotlight"

/**
 * The tour walks the left rail from top to bottom, one tab per step, in the order the nav itself is written – so the highlight travels down the list the way a finger would, and finishing the tour has covered every door out of the page rather than the five somebody thought to mention.
 *
 * The Doomscroller is the one step that names two things: the tab, and the player the tab opens. It carries `also` for the rail feed, which is what lights both at once and draws the line between them. Where the rail is not on screen – below xl, or with the feed closed – the step falls back to the tab alone, and below lg `selector` finds the header link instead, since the phone tab bar has no Doomscroller cell.
 */
const TOUR = [
	{
		selector: '[data-tour="nav-home"]',
		title: "Home",
		body: "Here's the main map, where you can log time for your projects, post reels to the Doomscroller, and submit your projects.",
	},
	{
		selector: '[data-tour="nav-doomscroller"], [data-tour="doomscroller-button"]',
		also: '[data-tour="doomscroller"]',
		title: "The Doomscroller",
		body: "Every teenager working on Half Life will be posting short videos about their projects to the platform! Now you can doomscroll forever (technically productive).",
	},
	{
		selector: '[data-tour="nav-projects"]',
		title: "Projects",
		body: "Here's where you manage your projects and edit their details. You can also view your journal entries, lapses, and reels in chronological order.",
	},
	{
		selector: '[data-tour="nav-reels"]',
		title: "Reels",
		body: "Manage all the reels you've posted to the platform! If you post them online, add your sharable links here so you can get coins if you go viral!",
	},
	{
		selector: '[data-tour="nav-explore"]',
		title: "Explore",
		body: "A feed of all the journal entries teenagers are making around the world.",
	},
	{
		selector: '[data-tour="nav-shop"]',
		title: "Shop",
		body: "See what you can buy with your coins!",
	},
	{
		selector: '[data-tour="nav-docs"]',
		title: "Docs",
		body: "Confused? Learn how tiers work, what counts as a session, and the checklist reviewers actually use when they read your submission.",
	},
]

function CheckpointModal({ id }: { id: string }) {
	const { allCheckpoints, weekOfCheckpoint, statusOf, sharePost, setSharePost, setOpenCheckpoint } = useStore()
	const cp = allCheckpoints.find(c => c.id === id)
	if (!cp) return null
	// A hand-in that posted its closing reel celebrates first. The hand-in's refresh flips the week to in_review underneath, and without this branch the unsubmit sheet below would take the modal a frame after the celebration lands.
	if (sharePost && sharePost.checkpointId === id) {
		return (
			<PublicReelModal
				celebration={sharePost.celebration}
				eyebrow={sharePost.eyebrow}
				onClose={() => {
					setSharePost(null)
					setOpenCheckpoint(null)
				}}
				postId={sharePost.postId}
				videoUrl={sharePost.videoUrl}
			/>
		)
	}
	// Handed in and waiting: the checkpoint's job now is to let it be taken back, not to walk the hand-in again over the top of the one in review.
	if ((cp.kind === "submit" || cp.kind === "demo") && statusOf(weekOfCheckpoint(cp)) === "in_review") {
		return <UnsubmitModal checkpoint={cp} />
	}
	switch (cp.kind) {
		case "onboarding":
			return <FirstCheckpoint />
		case "journal":
			return <JournalModal checkpoint={cp} />
		case "reel":
			return <ReelModal checkpoint={cp} />
		case "project":
			return <ProjectModal checkpoint={cp} />
		case "submit":
		case "demo":
			return <SubmitModal checkpoint={cp} />
		default:
			return null
	}
}

export function Overlays() {
	const {
		hydrated,
		phase,
		setPhase,
		openCheckpoint,
		setOpenCheckpoint,
		tourStep,
		setTourStep,
		finishTour,
		currentCheckpointId,
		isPassed,
		weekStarted,
		onboardingDone,
		participantGoal,
	} = useStore()
	const pathname = usePathname()
	const router = useRouter()

	const needsHome = phase === "aim" || phase === "cinematic"

	// The one question that has to be answered before the platform lets anyone carry on. It is read off the server rather than off the ceremony state, so it is the same on every device and comes back on every sign-in until it is answered – clearing localStorage or switching laptop does not lose it.
	//
	// `onboardingDone` is the other half of the gate and not a detail: asked before the first checkpoint it would be a question about hardware experience asked by the same form that asks about hardware experience.
	const needsGoal = onboardingDone && participantGoal === null

	useEffect(() => {
		if (hydrated && needsHome && pathname !== PLATFORM_HOME) router.push(PLATFORM_HOME)
	}, [hydrated, needsHome, pathname, router])

	// Closing the setup modal without finishing drops you back to the prompt rather than into a half-onboarded state with no way back.
	useEffect(() => {
		if (phase === "checkpoint" && !openCheckpoint) setPhase("aim")
	}, [phase, openCheckpoint, setPhase])

	// Coming back from signing in with Lapse: reopen the entry that sent you, on the tab you left from. The param is dropped straight away so a refresh or a shared link does not keep reopening it.
	useEffect(() => {
		if (!hydrated) return
		const url = new URL(window.location.href)
		const journal = url.searchParams.get("journal")
		if (!journal) return
		url.searchParams.delete("journal")
		window.history.replaceState(null, "", url.pathname + url.search + url.hash)
		// The week may have closed while they were away signing in; its entry stays shut then, exactly as the trail keeps it.
		if (!isPassed(journal)) setOpenCheckpoint(journal)
	}, [hydrated, setOpenCheckpoint, isPassed])

	// Before week 1 there is nothing on the trail to start, so the tour ends on the projects page, where a warm-up project can be.
	const endTour = () => {
		finishTour()
		setTourStep(0)
		if (!weekStarted(1)) router.push("/projects")
	}

	if (!hydrated) return null

	if (phase === "cinematic") return <Cinematic />

	return (
		<>
			{openCheckpoint && <CheckpointModal id={openCheckpoint} />}

			{/*
			 * Uncloseable, and above everything else here. It waits its turn rather
			 * than stacking: `openCheckpoint` is the first checkpoint's own modal, and
			 * the tour is the thing this most often lands on top of, since answering
			 * the goal hands you straight into it.
			 */}
			{needsGoal && !openCheckpoint && <GoalModal dismissible={false} onClose={() => {}} open />}

			{phase === "aim" && !openCheckpoint && !needsGoal && pathname === PLATFORM_HOME && (
				<Spotlight
					body="The yellow checkpoint is your setup: six quick questions and your first project exists at the end of them."
					cta="Open it"
					onNext={() => {
						setPhase("checkpoint")
						setOpenCheckpoint(currentCheckpointId)
					}}
					onSkip={() => setPhase("done")}
					pad={14}
					radius={999}
					selector='[data-tour="first-checkpoint"]'
					title="Start here"
				/>
			)}

			{phase === "tour" && !openCheckpoint && !needsGoal && (
				<Spotlight
					also={TOUR[tourStep]?.also}
					body={TOUR[tourStep]?.body ?? ""}
					clickAnywhere
					cta={tourStep === TOUR.length - 1 ? (weekStarted(1) ? "Start week 1" : "Start warm-up") : "Next"}
					onNext={() => {
						if (tourStep >= TOUR.length - 1) endTour()
						else setTourStep(tourStep + 1)
					}}
					onSkip={endTour}
					// Deliberately not keyed on the step: one instance living across all seven is what lets the window travel down the rail instead of blinking out and back. The two-target sequence resets on its own, off the second target appearing rather than off a remount.
					selector={TOUR[tourStep]?.selector ?? ""}
					step={tourStep + 1}
					title={TOUR[tourStep]?.title ?? ""}
					total={TOUR.length}
				/>
			)}
		</>
	)
}
