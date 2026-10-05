import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Avatar } from "@/components/platform/Avatar"
import { WeekPainting } from "@/components/platform/art"
import { IconChevronLeft, IconClock, IconFilm, IconFlame, IconPencil } from "@/components/platform/icons"
import { ProjectThumb } from "@/components/platform/ProjectThumb"
import { Panel } from "@/components/platform/ui"
import { requireSessionPage } from "@/lib/page-guards"
import { fmtDate, fmtHours } from "@/lib/projects"
import { getProfile } from "@/lib/queries/profile"
import { PLATFORM_HOME } from "@/lib/routes"
import { ProfileReels } from "./ProfileReels"

export const metadata: Metadata = {
	title: "Half Life Profile",
	description: "A maker's projects and the reels they have posted.",
}

export const dynamic = "force-dynamic"

/**
 * One maker's profile: who they are, what they have built, and what they have
 * posted to the Doomscroller.
 *
 * Reached by selecting a poster's name on a reel. Someone else's and your own
 * are the same page — the projects and reels are all public work, and nothing
 * private is read for it — so the only difference is the `isViewer` flag, which
 * the header uses to name the trail as the way on rather than a back link to a
 * feed you may not have come from.
 */
export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
	const { user } = await requireSessionPage()
	const { id } = await params
	const profile = await getProfile(id, user.id)
	if (!profile) notFound()

	const hasWork = profile.projects.length > 0 || profile.reels.length > 0

	return (
		<div className="mx-auto w-full max-w-[960px] px-4 pt-6 pb-10 sm:px-8">
			<Link
				href={profile.isViewer ? PLATFORM_HOME : "/doomscroller"}
				className="label inline-flex items-center gap-1.5 text-navy-soft transition-colors hover:text-navy"
			>
				<IconChevronLeft className="text-base" /> {profile.isViewer ? "Your trail" : "Doomscroller"}
			</Link>

			{/* ---------- who ---------- */}
			<Panel tone="line" radius={22} className="mt-5 bg-paper px-5 py-5 sm:px-7 sm:py-6">
				<div className="flex flex-wrap items-center gap-4 sm:gap-5">
					{profile.image ? (
						// eslint-disable-next-line @next/next/no-img-element -- the avatar host (Slack via Cachet) is known only at runtime
						<img
							src={profile.image}
							alt=""
							className="size-20 shrink-0 rounded-2xl border-2 border-line bg-sky-pale object-cover"
						/>
					) : (
						<Avatar name={profile.name} image={null} shape="tile" className="size-20 text-[2rem]" />
					)}
					<div className="min-w-0 flex-1">
						<h1 className="text-[1.5rem] leading-tight font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere] text-navy sm:text-[1.9rem]">
							{profile.name}
							{profile.isViewer && <span className="label ml-3 align-middle text-navy-faint">that&rsquo;s you</span>}
						</h1>
						<p className="hand mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.84rem] text-navy-soft tabular-nums">
							<span className="inline-flex items-center gap-1.5 text-coral-deep">
								<IconFlame className="text-sm text-coral" /> {profile.streak} day streak
							</span>
							<span className="inline-flex items-center gap-1.5">
								<IconPencil className="text-sm" /> {profile.projects.length}{" "}
								{profile.projects.length === 1 ? "project" : "projects"}
							</span>
							<span className="inline-flex items-center gap-1.5">
								<IconFilm className="text-sm" /> {profile.reelCount} {profile.reelCount === 1 ? "reel" : "reels"}
							</span>
							{profile.joinedAt > 0 && <span>building since {fmtDate(profile.joinedAt)}</span>}
						</p>
					</div>
				</div>
			</Panel>

			{/* ---------- what they have built ---------- */}
			{profile.projects.length > 0 && (
				<section aria-labelledby="profile-projects" className="mt-8">
					<h2 id="profile-projects" className="label mb-3 text-violet-deep">
						Projects
					</h2>
					<ul className="grid gap-4 sm:grid-cols-2">
						{profile.projects.map((project) => (
							<Panel key={project.id} as="li" tone="line" radius={20} className="overflow-hidden bg-paper">
								<Link href={`/projects/${project.id}`} className="group flex h-full flex-col">
									<span
										className="relative grid aspect-[16/9] place-items-center overflow-hidden"
										style={{ background: project.thumbnail ? "var(--color-navy)" : project.accent }}
									>
										{project.thumbnail ? (
											<ProjectThumb
												thumb={project.thumbnail}
												className="h-full w-full transition-transform duration-300 group-hover:scale-[1.04]"
											/>
										) : (
											<WeekPainting
												theme={project.painting}
												alt=""
												sizes="(min-width: 640px) 420px, 90vw"
												className="sticker-shadow aspect-square h-full transition-transform duration-300 group-hover:scale-[1.04]"
											/>
										)}
										<span className="label absolute top-2.5 left-2.5 rounded-full bg-white/90 px-2.5 py-1 text-navy">
											{project.themeLabel}
										</span>
									</span>
									<span className="flex flex-1 flex-col px-4 py-4">
										<span className="min-w-0 text-[1.05rem] leading-tight font-extrabold [overflow-wrap:anywhere] text-navy group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4">
											{project.title}
										</span>
										<span className="mt-auto flex flex-wrap items-center gap-x-3.5 gap-y-1 pt-3.5">
											<span className="hand inline-flex items-center gap-1.5 text-[0.8rem] text-navy-soft tabular-nums">
												<IconClock className="text-sm" /> {fmtHours(project.hours)}
											</span>
											<span className="hand inline-flex items-center gap-1.5 text-[0.8rem] text-navy-soft tabular-nums">
												<IconPencil className="text-sm" /> {project.entries}
											</span>
										</span>
									</span>
								</Link>
							</Panel>
						))}
					</ul>
				</section>
			)}

			{/* ---------- what they have posted ---------- */}
			{profile.reels.length > 0 && (
				<section aria-labelledby="profile-reels" className="mt-8">
					<div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
						<h2 id="profile-reels" className="label text-violet-deep">
							Reels
						</h2>
						{profile.reelCount > profile.reels.length && (
							<span className="hand text-[0.84rem] text-navy-soft">
								showing the newest {profile.reels.length} of {profile.reelCount}
							</span>
						)}
					</div>
					<ProfileReels initial={profile.reels} />
				</section>
			)}

			{!hasWork && (
				<Panel tone="line" radius={20} className="mt-8 bg-paper px-6 py-12 text-center">
					<p className="text-[1.05rem] font-extrabold text-navy">Nothing here yet</p>
					<p className="hand mx-auto mt-2 max-w-[44ch] text-[0.9rem] leading-relaxed text-navy-soft">
						{profile.isViewer
							? "start a project on the trail and post a reel, and it collects here."
							: `${profile.name} hasn't started a project yet.`}
					</p>
					{profile.isViewer && (
						<Link
							href={PLATFORM_HOME}
							className="label mt-6 inline-flex items-center gap-1.5 rounded-full border-2 border-line px-4 py-2 text-navy-soft transition-colors hover:border-navy hover:text-navy"
						>
							Go to the trail
						</Link>
					)}
				</Panel>
			)}
		</div>
	)
}
