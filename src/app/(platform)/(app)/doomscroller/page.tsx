import type { Metadata } from "next"
import { ReelViewer } from "@/components/platform/reels/ReelViewer"

export const metadata: Metadata = {
	description: "Every reel anyone posts, newest first. The fastest way to see what the program is building this week.",
	title: "Half Life Doomscroller",
}

export default function DoomscrollerPage() {
	return (
		<>
			{/* The reel is the page here, so the title is for assistive tech only – no hanging sign competing with it for the frame. */}
			<h1 className="sr-only">Doomscroller</h1>
			<ReelViewer />
		</>
	)
}
