"use client"

import { useRef, useState } from "react"
import { IconArrowRight, IconCheck, IconClock, IconWarning } from "@/components/platform/icons"
import { Button } from "@/components/platform/ui"
import { linkLapse } from "@/lib/auth-client"
import { COINS_PER_HOUR } from "@/lib/config/printers"
import { WARMUP_WEEK_ID } from "@/lib/config/program"
import { photosRequired } from "@/lib/curriculum"
import { cx } from "@/lib/cx"
import { ParticipantGoal } from "@/lib/enums"
import { countImages, proseLength } from "@/lib/markdown"
import { fmtHours } from "@/lib/numbers"
import { MAX_SESSION_HOURS } from "@/lib/schemas/session"
import { useStore } from "@/lib/store"
import type { Checkpoint, Week } from "@/lib/types"
import { cleanBodyForAutosave, isWeeksProject, stashJournalDraft, weekName } from "./checkpoint-shared"
import { JournalEntryTab, JournalTabSwitcher, JournalTimelapseTab } from "./JournalTabs"
import { useJournalDraft } from "./journal-draft"
import { useJournalImages } from "./journal-images"
import { Modal } from "./Modal"

/** The journal sheet's footer: why the button is greyed, or what saving will do, and the save itself. */
function JournalFooter({
	chasingPrinter,
	editing,
	missing,
	ok,
	save,
	saveError,
	saving,
	showGoal,
	toFloor,
	toGoal,
	uploading,
	week,
	weeklyGoalCoins,
}: {
	chasingPrinter: boolean
	editing: boolean
	missing: string | null
	ok: boolean
	save(): void
	saveError: string | null
	saving: boolean
	showGoal: boolean
	toFloor: number
	toGoal: number
	uploading: number
	week: Week
	weeklyGoalCoins: number
}) {
	return (
		<>
			<div className="mr-auto flex min-w-[min(100%,16rem)] flex-1 items-center gap-3">
				{missing || saveError ? (
					<IconWarning className="shrink-0 text-lg text-coral" />
				) : (
					<IconClock className="shrink-0 text-lg text-navy-soft" />
				)}
				<p
					className={cx(
						"hand min-w-0 flex-1 text-[0.76rem] leading-snug",
						missing || saveError ? "text-coral-deep" : "text-navy-soft",
					)}
					role={saveError ? "alert" : undefined}
				>
					{saveError ? (
						saveError
					) : uploading > 0 ? (
						`Uploading ${uploading === 1 ? "an image" : `${uploading} images`}…`
					) : missing ? (
						missing
					) : editing ? (
						"Saving replaces this entry. It keeps its place on the map."
					) : toFloor > 0 ? (
						<>
							{fmtHours(toFloor)} more before you can {week.id === WARMUP_WEEK_ID ? "submit it" : "wrap up the week"}
							{showGoal ? (
								<>
									, and {fmtHours(toGoal)} more if you want to reach your goal of{" "}
									<strong className="rounded bg-gold-pale px-1 text-gold-ink">{weeklyGoalCoins} coins</strong> per week.
								</>
							) : !chasingPrinter ? (
								<>
									. Every hour past the minimum earns{" "}
									<strong className="rounded bg-gold-pale px-1 text-gold-ink">5 coins</strong> per hour.
								</>
							) : (
								"."
							)}
						</>
					) : (
						"Submit your project when it's done!"
					)}
				</p>
			</div>

			<Button disabled={!ok || saving || uploading > 0} onClick={() => save()} variant="solid">
				{saving ? "Saving…" : editing ? "Save changes" : "Finish"}{" "}
				{editing ? <IconCheck className="text-base" /> : <IconArrowRight className="text-base" />}
			</Button>
		</>
	)
}

export function JournalModal({ checkpoint }: { checkpoint: Checkpoint }) {
	const {
		setOpenCheckpoint,
		logSession,
		editSession,
		complete,
		projects,
		stateOf,
		weekOfCheckpoint,
		hoursOf,
		participantGoal,
	} = useStore()

	const week = weekOfCheckpoint(checkpoint)

	// Every journal node is one entry: write it and it is done. The week's clock is what decides whether wrapping up is on the table yet. Opened again once it is done, the same sheet is that entry, to correct – not a new one.
	// oxlint-disable-next-line react/hook-use-state
	const [existing] = useState(() => {
		const saved = stateOf(checkpoint.id)
		return saved.done ? saved.log[0] : undefined
	})

	const {
		body,
		clipsTouchedRef,
		clearDraft,
		discardDraft,
		draftRestored,
		editing,
		hasUnsavedWork,
		hoursText,
		legacyBump,
		legacyKept,
		picked,
		pinned,
		preview,
		setBody,
		setHoursText,
		setPicked,
		setPinned,
		setPreview,
		setTab,
		tab,
	} = useJournalDraft(checkpoint.id, existing)

	const { addJournalImages, dragHandlers, dragging, entry, imageError, uploading } = useJournalImages({ body, setBody })

	const imageInput = useRef<HTMLInputElement>(null)
	const [saving, setSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)

	// The fallback is for a season sheet opened before its project row landed; it must never pick the warm-up project, which has no season week.
	const project =
		projects.find(p => isWeeksProject(week, p)) ?? projects.find(p => p.weekId !== WARMUP_WEEK_ID) ?? projects[0]

	// The claim is what the maker types. The photographs are what makes it a claim rather than a number, which is why the bar rises with it – and they are counted out of the entry itself, so every picture sits in the sentence that explains it instead of in a tray underneath.
	const typed = Math.max(0, Number(hoursText) || 0)
	// The hours box declares what the timelapses do not cover, so the claim is the two added together: 2 typed hours on top of a 5-hour recording logs
	// 7. Leave the box empty and the recording sets the claim on its own – the maker is never asked to retype a number Lapse already has.
	const coveredSeconds = picked.reduce((sum, t) => sum + t.durationSeconds, 0)
	const lapseHours = Math.round((coveredSeconds / 3600) * 100) / 100
	const claimed = typed + lapseHours
	// At least a minute once there is a claim, so a short recording is not rounded down to nothing.
	const sessionMinutes = claimed > 0 ? Math.max(1, Math.round(claimed * 60)) : 0
	// Screenshots back the written entry, so they follow the typed hours: 2 additional hours need two screenshots, however long the timelapses run.
	const needPhotos = photosRequired(typed)
	const shots = countImages(body)
	// Words only: the images are counted above, not twice.
	const written = proseLength(body)

	const longEnough = written >= 200
	const enoughPhotos = shots >= needPhotos
	// A session is backed by a journal entry, a Lapse timelapse, or both together: each one is evidence a reviewer can check the hours against, and the two land on the same entry. A written entry needs its hours typed; a timelapse brings its own.
	const journalled = longEnough && enoughPhotos
	const attachedCount = picked.length + pinned.length + legacyKept.length
	const recorded = attachedCount > 0
	const overCap = claimed > MAX_SESSION_HOURS
	const ok = claimed > 0 && !overCap && (journalled || recorded)

	// One thing at a time – a list of four faults reads as a wall, and only the first one is actionable anyway. Once the hours are in, the entry's next shortfall is named with the other way out beside it, so nobody is told to write 200 characters they could skip with a timelapse.
	const orLapse = " You can also attach Lapse timelapses on the Timelapse tab. They back the same entry."
	const missing = !ok
		? overCap
			? `A single devlog covers at most ${MAX_SESSION_HOURS} hours. Split longer work across sessions.`
			: claimed <= 0
				? "Add the hours you spent on this session, or pick a Lapse timelapse."
				: !longEnough
					? `${200 - written} more characters in your entry, not counting images.${orLapse}`
					: `${needPhotos - shots} more ${needPhotos - shots === 1 ? "image" : "images"} in your entry for ${fmtHours(typed)}.${orLapse}`
		: null

	const hours = hoursOf(week)
	const toFloor = Math.max(0, week.submitHours - hours)
	// The week's earning goal, read off its own target rather than the goal catalogue: targetHours already bakes in this week's tier (weekAsk slides the funded block in underneath the pace) and earnFrom is where coins start, so their difference at the coin rate is what this tier and this goal ask together. Warm-ups have no season pace, so they keep the bare floor message.
	const weeklyGoalCoins = Math.round((week.targetHours - week.earnFrom) * COINS_PER_HOUR)
	const toGoal = Math.max(0, week.targetHours - hours)
	// Makers here for the grant have no machine to pace against – GoalTracker reads the same flag – so the weekly goal means nothing to them and they get the flat rate instead.
	const chasingPrinter = participantGoal === null || participantGoal === ParticipantGoal.PRINTER
	const showGoal = chasingPrinter && week.id !== WARMUP_WEEK_ID && toGoal > 0

	/**
	 * Finishing hands the maker back to the trail rather than straight into another entry. What comes next is the trail's to say: logging these hours may have brought a reel due, or opened the fork at the end of the week, and a modal that reopens itself would march past both.
	 */
	async function save() {
		if (saving || uploading > 0) return
		setSaving(true)
		setSaveError(null)
		if (editing) {
			// The full set the server reconciles against: Lapse picks and pins plus the older uploads, which the server keeps silently – sending them keeps the local snapshot agreeing with it until the refresh.
			const refused = await editSession(checkpoint.id, sessionMinutes, body.trim(), {
				clips: [...legacyKept, ...pinned, ...picked.map(t => t.id)],
			})
			setSaving(false)
			if (refused) setSaveError(refused)
			else {
				clearDraft()
				setOpenCheckpoint(null)
			}
			return
		}
		const refused = await logSession(checkpoint.id, sessionMinutes, body.trim(), {
			clips: picked.map(t => t.id),
		})
		setSaving(false)
		if (refused) {
			setSaveError(refused)
			return
		}
		clearDraft()
		complete(checkpoint.id)
		setOpenCheckpoint(null)
	}

	async function signInWithLapse() {
		stashJournalDraft(checkpoint.id, {
			body: cleanBodyForAutosave(body),
			hoursText,
			legacy: legacyKept,
			picked,
			pinned,
			tab: "timelapse",
		})
		await linkLapse(`${window.location.pathname}?journal=${encodeURIComponent(checkpoint.id)}`)
	}

	return (
		<Modal
			accent="var(--color-violet)"
			eyebrow={`${weekName(week)} · ${checkpoint.title}`}
			footer={
				<JournalFooter
					chasingPrinter={chasingPrinter}
					editing={editing}
					missing={missing}
					ok={ok}
					save={save}
					saveError={saveError}
					saving={saving}
					showGoal={showGoal}
					toFloor={toFloor}
					toGoal={toGoal}
					uploading={uploading}
					week={week}
					weeklyGoalCoins={weeklyGoalCoins}
				/>
			}
			onClose={() => setOpenCheckpoint(null)}
			open
			scrollKey={tab}
			size="lg"
		>
			<JournalTabSwitcher attachedCount={attachedCount} setTab={setTab} tab={tab} />
			{tab === "journal" ? (
				<JournalEntryTab
					addJournalImages={addJournalImages}
					body={body}
					claimed={claimed}
					coveredSeconds={coveredSeconds}
					discardDraft={discardDraft}
					draftRestored={draftRestored}
					dragging={dragging}
					dragHandlers={dragHandlers}
					editing={editing}
					entry={entry}
					hasUnsavedWork={hasUnsavedWork}
					hoursText={hoursText}
					imageError={imageError}
					imageInput={imageInput}
					lapseHours={lapseHours}
					legacyBump={legacyBump}
					longEnough={longEnough}
					needPhotos={needPhotos}
					overCap={overCap}
					picked={picked}
					preview={preview}
					project={project}
					setBody={setBody}
					setHoursText={setHoursText}
					setPreview={setPreview}
					shots={shots}
					typed={typed}
					uploading={uploading}
					week={week}
					written={written}
				/>
			) : (
				<JournalTimelapseTab
					claimed={claimed}
					clipsTouchedRef={clipsTouchedRef}
					coveredSeconds={coveredSeconds}
					editing={editing}
					existing={existing}
					legacyKept={legacyKept}
					picked={picked}
					pinned={pinned}
					setPicked={setPicked}
					setPinned={setPinned}
					signInWithLapse={signInWithLapse}
				/>
			)}
		</Modal>
	)
}
