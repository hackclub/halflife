import { describe, expect, test } from "bun:test"
import { Phase, PhaseStatus, Theme } from "@/lib/enums"
import { canSubmitPhase } from "@/lib/submissions"

const project = {
	buildStatus: PhaseStatus.draft,
	designStatus: PhaseStatus.update_requested,
	theme: Theme.PCB,
	warmupPhase: null,
}

describe("canSubmitPhase", () => {
	test("allows a build after the design was returned", () => {
		expect(canSubmitPhase(project, Phase.BUILD)).toEqual({ ok: true })
	})

	test("refuses a build whose design is still a draft", () => {
		expect(canSubmitPhase({ ...project, designStatus: PhaseStatus.draft }, Phase.BUILD)).toMatchObject({
			code: "PHASE_LOCKED",
			ok: false,
		})
	})

	test("refuses a build behind a rejected design", () => {
		expect(canSubmitPhase({ ...project, designStatus: PhaseStatus.rejected }, Phase.BUILD)).toMatchObject({
			code: "PHASE_LOCKED",
			ok: false,
		})
	})
})
