"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  JournalModal,
  ProjectModal,
  ReelModal,
  SubmitModal,
  UnsubmitModal,
} from "@/components/platform/modals/CheckpointModals";
import { FirstCheckpoint } from "@/components/platform/modals/FirstCheckpoint";
import { useStore } from "@/lib/store";
import { Cinematic } from "./Cinematic";
import { Spotlight } from "./Spotlight";
import { PLATFORM_HOME } from "@/lib/routes";

/**
 * The tour walks the left rail from top to bottom, one tab per step, in the
 * order the nav itself is written — so the highlight travels down the list the
 * way a finger would, and finishing the tour has covered every door out of the
 * page rather than the five somebody thought to mention.
 *
 * The Doomscroller is the one step that names two things: the tab, and the
 * player the tab opens. It carries `also` for the rail feed, which is what
 * lights both at once and draws the line between them. Where the rail is not on
 * screen — below xl, or with the feed closed — the step falls back to the tab
 * alone, and below lg `selector` finds the header link instead, since the phone
 * tab bar has no Doomscroller cell.
 */
const TOUR = [
  {
    selector: '[data-tour="nav-home"]',
    title: "Home",
    body: "The trail. Ten weeks of checkpoints, and the only one you can open is the one you are on — everything you log happens here.",
  },
  {
    selector: '[data-tour="nav-doomscroller"], [data-tour="doomscroller-button"]',
    also: '[data-tour="doomscroller"]',
    title: "The Doomscroller",
    body: "Every reel anyone posts lands here, newest first — in the rail on the right while you work, or full screen from the tab.",
  },
  {
    selector: '[data-tour="nav-projects"]',
    title: "Projects",
    body: "Everything you have started, each with its journal, its reels and its tier. The tier stays changeable here until you submit the week.",
  },
  {
    selector: '[data-tour="nav-explore"]',
    title: "Explore",
    body: "The long-form side: everyone's journal entries, with the photos and the parts that did not work.",
  },
  {
    selector: '[data-tour="nav-shop"]',
    title: "Shop",
    body: "Coins from your logged hours buy grants, tools and parts here. Hardware grants land straight on your card.",
  },
  {
    selector: '[data-tour="nav-docs"]',
    title: "Docs",
    body: "How tiers work, what counts as a session, and the checklist reviewers actually use when they read your submission.",
  },
  {
    selector: '[data-tour="nav-leaderboard"]',
    title: "Leaderboard",
    body: "Hours logged and weeks shipped across the program. Entirely cosmetic, entirely motivating.",
  },
];

function CheckpointModal({ id }: { id: string }) {
  const { allCheckpoints, phaseStatusOf } = useStore();
  const cp = allCheckpoints.find((c) => c.id === id);
  if (!cp) return null;
  // Handed in and waiting: the checkpoint's job now is to let it be taken
  // back, not to walk the hand-in again over the top of the one in review.
  if ((cp.kind === "submit" || cp.kind === "demo") && phaseStatusOf(cp.weekId) === "in_review") {
    return <UnsubmitModal checkpoint={cp} />;
  }
  switch (cp.kind) {
    case "onboarding":
      return <FirstCheckpoint />;
    case "journal":
      return <JournalModal checkpoint={cp} />;
    case "reel":
      return <ReelModal checkpoint={cp} />;
    case "project":
      return <ProjectModal checkpoint={cp} />;
    case "submit":
    case "demo":
      return <SubmitModal checkpoint={cp} />;
    default:
      return null;
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
    currentCheckpointId,
    isPassed,
  } = useStore();
  const pathname = usePathname();
  const router = useRouter();

  const needsHome = phase === "aim" || phase === "cinematic";

  useEffect(() => {
    if (hydrated && needsHome && pathname !== PLATFORM_HOME) router.push(PLATFORM_HOME);
  }, [hydrated, needsHome, pathname, router]);

  // Closing the setup modal without finishing drops you back to the prompt
  // rather than into a half-onboarded state with no way back.
  useEffect(() => {
    if (phase === "checkpoint" && !openCheckpoint) setPhase("aim");
  }, [phase, openCheckpoint, setPhase]);

  // Coming back from signing in with Lapse: reopen the entry that sent you,
  // on the tab you left from. The param is dropped straight away so a refresh
  // or a shared link does not keep reopening it.
  useEffect(() => {
    if (!hydrated) return;
    const url = new URL(window.location.href);
    const journal = url.searchParams.get("journal");
    if (!journal) return;
    url.searchParams.delete("journal");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    // The week may have closed while they were away signing in; its entry
    // stays shut then, exactly as the trail keeps it.
    if (!isPassed(journal)) setOpenCheckpoint(journal);
  }, [hydrated, setOpenCheckpoint, isPassed]);

  if (!hydrated) return null;

  if (phase === "cinematic") return <Cinematic />;

  return (
    <>
      {openCheckpoint && <CheckpointModal id={openCheckpoint} />}

      {phase === "aim" && !openCheckpoint && pathname === PLATFORM_HOME && (
        <Spotlight
          selector='[data-tour="first-checkpoint"]'
          title="Start here"
          body="The yellow checkpoint is your setup: six quick questions and your first project exists at the end of them."
          cta="Open it"
          pad={14}
          radius={999}
          onNext={() => {
            setPhase("checkpoint");
            setOpenCheckpoint(currentCheckpointId);
          }}
          onSkip={() => setPhase("done")}
        />
      )}

      {phase === "tour" && !openCheckpoint && (
        <Spotlight
          // Deliberately not keyed on the step: one instance living across all
          // seven is what lets the window travel down the rail instead of
          // blinking out and back. The two-target sequence resets on its own,
          // off the second target appearing rather than off a remount.
          selector={TOUR[tourStep]?.selector ?? ""}
          also={TOUR[tourStep]?.also}
          title={TOUR[tourStep]?.title ?? ""}
          body={TOUR[tourStep]?.body ?? ""}
          step={tourStep + 1}
          total={TOUR.length}
          clickAnywhere
          cta={tourStep === TOUR.length - 1 ? "Start week 1" : "Next"}
          onNext={() => {
            if (tourStep >= TOUR.length - 1) {
              setPhase("done");
              setTourStep(0);
            } else {
              setTourStep(tourStep + 1);
            }
          }}
          onSkip={() => {
            setPhase("done");
            setTourStep(0);
          }}
        />
      )}
    </>
  );
}
