import type { Metadata } from "next"
import { NpsGate } from "@/components/platform/modals/NpsModal"
import { CheckpointPath } from "@/components/platform/path/CheckpointPath"

export const metadata: Metadata = {
	title: "Dashboard",
}

export default function HomePage() {
	return (
		<>
			<NpsGate />
			<CheckpointPath />
		</>
	)
}
