"use client"

import Link from "next/link"
import { IconCamera, IconCart, IconCheck, IconFilm, IconPencil, IconWarning } from "@/components/platform/icons"
import { ReelCapture } from "@/components/platform/reels/ReelCapture"
import { Chip, Field, inputClass, OptionRow } from "@/components/platform/ui"
import { MIN_PROJECT_DESCRIPTION_CHARS } from "@/lib/config/program"
import { cx } from "@/lib/cx"
import { SUBMISSION_LIMIT } from "@/lib/resubmissions"
import { ImageUploads } from "./ImageUploads"
import { ModalTitle } from "./Modal"
import { RepoChecks } from "./RepoChecks"
import { SubmissionReelPicker } from "./SubmissionReelPicker"
import { BomTable, SubmissionAcknowledgements, SubmitNotice, TierPicker } from "./submit-parts"
import type { SubmitSheet } from "./submit-sheet"

/**
 * The banners above the steps: why this hand-in is different, and what still blocks it.
 *
 * Every step reads the same set, because a maker who is short on hours or missing a cover should find that out before working through the checklist, not after.
 */
export function SubmitNotices({ sheet }: { sheet: SubmitSheet }) {
	const {
		descriptionLength,
		descriptionReady,
		hasCover,
		owed,
		outOfSubmissions,
		project,
		resubmitting,
		starterDescriptionReady,
		submissionsLeft,
		submissionsUsed,
	} = sheet
	return (
		<>
			{resubmitting && (
				<SubmitNotice
					icon={
						<IconWarning
							className={cx("mt-0.5 shrink-0 text-xl", outOfSubmissions ? "text-coral-deep" : "text-gold-ink")}
						/>
					}
					title={
						outOfSubmissions
							? `All ${SUBMISSION_LIMIT} submissions for this phase are used.`
							: `Submission ${submissionsUsed + 1} of ${SUBMISSION_LIMIT} for this phase`
					}
					tone={outOfSubmissions ? "coral" : "gold"}
				>
					{outOfSubmissions
						? "It stays returned for now. Dispute the review or ask a reviewer in Slack; you cannot submit it again. "
						: submissionsLeft === 1
							? "This is your last one. If it comes back needing changes again, you cannot submit it. "
							: `${submissionsLeft - 1} left after this one. `}
					{project && (
						<Link
							className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
							href={`/projects/${project.id}`}
							onClick={() => sheet.closeSheet()}
						>
							Go to project page
						</Link>
					)}
				</SubmitNotice>
			)}

			{/* On every step, not just the last one: a maker who is short on hours should find that out before working through the checklist, not after. It warns and does not block – the hours needed for a printer at all are the trail's gate, and this is the gap to the one they chose. */}
			{!hasCover && (
				<SubmitNotice
					icon={<IconCamera className="mt-0.5 shrink-0 text-xl text-coral-deep" />}
					title={project ? `${project.name} needs a cover image.` : "Your project needs a cover image."}
				>
					Upload a photo or screenshot of the project on that project&apos;s page before you can submit. Covers are per
					project, so a cover uploaded elsewhere does not count.{" "}
					{project && (
						<Link
							className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
							href={`/projects/${project.id}`}
							onClick={() => sheet.closeSheet()}
						>
							Go to project page
						</Link>
					)}
				</SubmitNotice>
			)}

			{!descriptionReady && (
				<SubmitNotice
					icon={<IconPencil className="mt-0.5 shrink-0 text-xl text-coral-deep" />}
					title={project ? `${project.name} needs a longer description.` : "Your project needs a longer description."}
				>
					A reviewer decides from the description, so it needs at least {MIN_PROJECT_DESCRIPTION_CHARS} characters. You
					have {descriptionLength}.{" "}
					{project && (
						<Link
							className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
							href={`/projects/${project.id}`}
							onClick={() => sheet.closeSheet()}
						>
							Edit the description
						</Link>
					)}
				</SubmitNotice>
			)}

			{!starterDescriptionReady && (
				<SubmitNotice
					icon={<IconPencil className="mt-0.5 shrink-0 text-xl text-coral-deep" />}
					title={
						project
							? `${project.name} still has the starter's description.`
							: "This project still has the starter's description."
					}
				>
					Write your own description. Say what you changed, why you made it, and what makes it yours.{" "}
					{project && (
						<Link
							className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
							href={`/projects/${project.id}`}
							onClick={() => sheet.closeSheet()}
						>
							Edit the description
						</Link>
					)}
				</SubmitNotice>
			)}

			{owed > 0 && (
				<SubmitNotice
					icon={<IconWarning className="mt-0.5 shrink-0 text-xl text-coral-deep" />}
					title="You're a little behind on your printer goal."
				>
					Spend some more time on it! You are <span className="font-bold text-navy tabular-nums">{owed}</span>{" "}
					{owed === 1 ? "coin" : "coins"} behind the pace for a{" "}
					<span className="font-bold text-navy">{sheet.goal.name}</span>. You can still submit it, and a bigger week
					later makes it up.
				</SubmitNotice>
			)}
		</>
	)
}

/** Step one: the repo's files, and the one waiver the Displays week allows. */
export function FilesStep({ sheet }: { sheet: SubmitSheet }) {
	const { firmwareMissing, isBuild, noMicrocontroller, project, setNoMicrocontroller, setRepoResult } = sheet
	return (
		<div>
			<ModalTitle
				sub={
					isBuild
						? "Reviewers watch the demo first and read everything else second. Get the video right."
						: "Source files, not exports. A PDF of a schematic is not a schematic."
				}
			>
				Check all files are included
			</ModalTitle>
			{project && (
				<RepoChecks onResult={setRepoResult} project={project} waivedFirmware={firmwareMissing && noMicrocontroller} />
			)}
			{/* The Displays week asks for firmware because most display projects drive one from a microcontroller. Some do not, and have no firmware to give: the box is the maker's confirmation, and it takes only that check off the gate. */}
			{firmwareMissing && (
				<label
					className={cx(
						"sketch mt-4 flex w-full cursor-pointer items-start gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-violet has-[input:focus-visible]:ring-offset-2",
						noMicrocontroller ? "bg-violet-pale" : "bg-white hover:bg-black/[.03]",
					)}
					style={{
						"--sk-color": noMicrocontroller ? "var(--color-violet)" : "var(--color-line)",
						"--sk-radius": "16px",
					}}
				>
					<input
						checked={noMicrocontroller}
						className="sr-only"
						onChange={() => setNoMicrocontroller(value => !value)}
						type="checkbox"
					/>
					<span
						aria-hidden="true"
						className={cx(
							"mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-[6px] border-2 transition-colors",
							noMicrocontroller ? "border-transparent bg-violet" : "border-line-strong",
						)}
					>
						{noMicrocontroller && <IconCheck className="text-sm text-white" />}
					</span>
					<span className="min-w-0">
						<span className="block text-[0.95rem] font-extrabold text-navy">My project has no microcontroller</span>
						<span className="hand mt-0.5 block text-[0.84rem] leading-snug text-navy-soft">
							There is no firmware to include. Tick this to hand the week in without it; a reviewer will see what drives
							the display instead.
						</span>
					</span>
				</label>
			)}
		</div>
	)
}

/** A design week's parts step: the list, the decline, the cart proof, and the tier it is all priced against. */
export function PartsStep({ sheet }: { sheet: SubmitSheet }) {
	const {
		bom,
		bomEmpty,
		bomError,
		bomOverCap,
		bomTotal,
		carts,
		declinedFunding,
		funding,
		fundingDeclined,
		goal,
		hours,
		partialFunding,
		project,
		selectedTier,
		setAcceptsPartialFunding,
		setCarts,
		setDeclinedFunding,
		setTier,
		tier,
		tierFloor,
		tierShort,
		toggleDeclinedFunding,
	} = sheet
	return (
		<div>
			<ModalTitle
				sub={
					fundingDeclined
						? "No parts, no order. Just the tier your hours unlock."
						: "Every line needs a real vendor and a real price. We ask for the cart screenshot so the total is checkable."
				}
			>
				{fundingDeclined ? "Finalise your tier" : "Finalise your BOM and tier"}
			</ModalTitle>

			{/* Declined funding hides the parts list and its edit note – there is nothing to check. */}
			{!fundingDeclined && (
				<>
					<BomTable bom={bom} bomError={bomError} bomTotal={bomTotal} />
					{/* One place to change the list: the project page. The sheet reads it, so what is handed in is what the maker kept there. */}
					{project && (
						<p className="hand mt-2 text-[0.82rem] text-navy-soft">
							Something wrong?{" "}
							<Link
								className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
								href={`/projects/${project.id}#bom-title`}
								onClick={() => sheet.closeSheet()}
							>
								Edit the parts list on the project page
							</Link>
							.
						</p>
					)}
				</>
			)}
			{/* Already stocked, or building from scrap: declining funding hands the week in with no grant and no order. An empty BOM needs it; a stocked one takes it as a choice. */}
			{bom !== null && (
				<label
					className={cx(
						"sketch mt-4 flex w-full cursor-pointer items-start gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-violet has-[input:focus-visible]:ring-offset-2",
						declinedFunding ? "bg-violet-pale" : "bg-white hover:bg-black/[.03]",
					)}
					style={{
						"--sk-color": declinedFunding ? "var(--color-violet)" : "var(--color-line)",
						"--sk-radius": "16px",
					}}
				>
					<input checked={declinedFunding} className="sr-only" onChange={toggleDeclinedFunding} type="checkbox" />
					<span
						aria-hidden="true"
						className={cx(
							"mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-[6px] border-2 transition-colors",
							declinedFunding ? "border-transparent bg-violet" : "border-line-strong",
						)}
					>
						{declinedFunding && <IconCheck className="text-sm text-white" />}
					</span>
					<span className="min-w-0">
						<span className="block text-[0.95rem] font-extrabold text-navy">
							I don&apos;t want parts funding for this project
						</span>
						<span className="hand mt-0.5 block text-[0.84rem] leading-snug text-navy-soft">
							{bomEmpty
								? "Submit with an empty parts list. No carts, no order. We'll double-check before you submit."
								: "Your parts list stays for the reviewer to see, but approving it orders no grant, so fund the build yourself. We'll double-check before you submit."}{" "}
							Your hours still earn 5 coins each, including the ones the grant would have paid for.
						</span>
					</span>
				</label>
			)}

			{/* No order, nothing to screenshot: the carts go away with the BOM. */}
			{!fundingDeclined && (
				<div className="mt-8 border-t border-dashed border-line pt-6">
					<div className="grid gap-2">
						<p className="label flex items-center gap-2 text-navy-soft">
							<IconCart className="text-base" /> Screenshots of your cart
						</p>
						<p className="text-[0.88rem] leading-snug text-navy-soft">
							The checkout page with the total visible. Any vendor works. Add one per cart if the order is split.
						</p>
						<ImageUploads folder="sessions" images={carts} label="Cart screenshot" max={10} onChange={setCarts} />
						{/* The gate below is `carts.length > 0`, and until now nothing on screen said so: the Next button simply stayed grey. Named here, next to the box that clears it. */}
						{carts.length === 0 && (
							<p className="mt-1 flex items-start gap-1.5 text-[0.84rem] leading-snug text-coral-deep">
								<IconWarning className="mt-0.5 shrink-0 text-sm" />
								<span>
									At least one cart screenshot is needed before you can carry on. It is what the parts total is checked
									against. One per cart if the order is split across vendors.
								</span>
							</p>
						)}
					</div>
				</div>
			)}

			<TierPicker
				bomOverCap={bomOverCap}
				bomTotal={bomTotal}
				funding={funding}
				fundingDeclined={fundingDeclined}
				goal={goal}
				hours={hours}
				partialFunding={partialFunding}
				selectedTier={selectedTier}
				setAcceptsPartialFunding={setAcceptsPartialFunding}
				setDeclinedFunding={setDeclinedFunding}
				setTier={setTier}
				tier={tier}
				tierFloor={tierFloor}
				tierShort={tierShort}
			/>
		</div>
	)
}

/** The closing step: the reel that says what was made, and the acknowledgements that go with handing it in. */
export function ReelStep({ sheet }: { sheet: SubmitSheet }) {
	const {
		acknowledgedAll,
		acknowledgedFixed,
		acknowledgedLimit,
		acknowledgedNoMore,
		bomTotal,
		clip,
		closingPostId,
		isBuild,
		reelCheckpointId,
		resubmitting,
		reuseClosingReel,
		setAcknowledgedAll,
		setAcknowledgedFixed,
		setAcknowledgedLimit,
		setAcknowledgedNoMore,
		setClip,
		setClipUrl,
		setClosingPostId,
		setWorks,
		setWriteup,
		tier,
		works,
		writeup,
	} = sheet
	return (
		<div>
			<ModalTitle
				sub={
					isBuild
						? "Thirty to sixty seconds of the project working, with your voice explaining what it does."
						: "One last reel walking through the finished design. Thirty seconds is plenty."
				}
			>
				{isBuild ? "Show it working" : "Final submission reel"}
			</ModalTitle>

			<div className="grid gap-2">
				<p className="label flex items-center gap-2 text-navy-soft">
					<IconCamera className="text-base" /> {isBuild ? "Your demo video" : "Your closing reel"}
				</p>
				<p className="text-[0.88rem] leading-snug text-navy-soft">
					{isBuild
						? "Point the camera at the thing, turn it on, and talk over it."
						: "Pan across the schematic, the layout, and the render."}
				</p>
				<ReelCapture
					objectKey={clip}
					onCaptured={(key, url) => {
						setClip(key)
						setClipUrl(url ?? null)
						setClosingPostId(null)
					}}
				/>
			</div>

			<SubmissionReelPicker checkpointKey={reelCheckpointId} onSelect={reuseClosingReel} selectedId={closingPostId} />

			{isBuild && (
				<div className="mt-6">
					<p className="label mb-2 text-magenta">Does it work?</p>
					<div className="grid gap-2.5 sm:grid-cols-2">
						<OptionRow onClick={() => setWorks("yes")} selected={works === "yes"}>
							<span className="text-[0.95rem] font-bold text-navy">Yes, it does the thing</span>
						</OptionRow>
						<OptionRow onClick={() => setWorks("no")} selected={works === "no"}>
							<span className="text-[0.95rem] font-bold text-navy">Not yet</span>
						</OptionRow>
					</div>

					{works === "no" && (
						<div className="mt-4">
							<Field
								hint="Reviewers pass honest failures and fail silent ones. Say what you would do next."
								id="writeup"
								label="What needs to change"
							>
								<textarea
									className={cx(inputClass, "resize-none")}
									id="writeup"
									onChange={e => setWriteup(e.target.value)}
									placeholder="The display initialises but stays blank. I think the reset pin is floating, so next revision ties it through a 10k to 3V3 and I will bodge it in the meantime."
									rows={5}
									value={writeup}
								/>
							</Field>
							<p
								className={cx(
									"hand mt-1.5 text-right text-[0.76rem] tabular-nums",
									writeup.trim().length >= 40 ? "text-teal-ink" : "text-navy-soft",
								)}
							>
								{writeup.trim().length} / 40 characters
							</p>
						</div>
					)}
				</div>
			)}

			<div className="mt-6 flex flex-wrap items-center gap-2.5">
				<Chip tone="teal">
					<IconCheck className="text-[0.9rem]" /> Files attached
				</Chip>
				{!isBuild && (
					<Chip tone="teal">
						<IconCheck className="text-[0.9rem]" /> BOM ${bomTotal.toFixed(2)} · tier {tier}
					</Chip>
				)}
				<Chip tone={clip ? "teal" : "muted"}>
					{clip ? <IconCheck className="text-[0.9rem]" /> : <IconFilm className="text-[0.9rem]" />}{" "}
					{clip ? "Video attached" : "Video missing"}
				</Chip>
			</div>

			<SubmissionAcknowledgements
				acknowledgedAll={acknowledgedAll}
				acknowledgedFixed={acknowledgedFixed}
				acknowledgedLimit={acknowledgedLimit}
				acknowledgedNoMore={acknowledgedNoMore}
				resubmitting={resubmitting}
				setAcknowledgedAll={setAcknowledgedAll}
				setAcknowledgedFixed={setAcknowledgedFixed}
				setAcknowledgedLimit={setAcknowledgedLimit}
				setAcknowledgedNoMore={setAcknowledgedNoMore}
			/>
		</div>
	)
}
