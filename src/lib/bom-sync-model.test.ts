import { describe, expect, test } from "bun:test"
import { type BomSnapshotLine, bomUndoBlock, sameBom } from "@/lib/bom-sync-model"
import { AuditAction } from "@/lib/enums"

const resistor: BomSnapshotLine = {
	link: null,
	name: "10k resistor",
	purpose: null,
	quantity: 10,
	unitCostUsd: 0.1,
	vendor: "DigiKey",
}
const led: BomSnapshotLine = {
	link: "https://example.com/led",
	name: "LED",
	purpose: "status",
	quantity: 2,
	unitCostUsd: 0.5,
	vendor: null,
}

describe("sameBom", () => {
	test("compares content, not identity", () => {
		expect(sameBom([resistor, led], [{ ...resistor }, { ...led }])).toBe(true)
	})

	test("an order change is a different list", () => {
		expect(sameBom([resistor, led], [led, resistor])).toBe(false)
	})

	test("a changed field, a missing line or an extra line is a different list", () => {
		expect(sameBom([resistor], [{ ...resistor, quantity: 11 }])).toBe(false)
		expect(sameBom([resistor, led], [resistor])).toBe(false)
		expect(sameBom([resistor], [resistor, led])).toBe(false)
	})

	test("two empty lists are the same", () => {
		expect(sameBom([], [])).toBe(true)
	})
})

describe("bomUndoBlock", () => {
	const synced = [resistor, led]

	test("a sync that is still the newest and unchanged can be undone", () => {
		expect(
			bomUndoBlock({
				current: [{ ...resistor }, { ...led }],
				latest: { action: AuditAction.ADMIN_SYNC_BOM, id: "a1" },
				lock: null,
				requestedId: "a1",
				synced,
			}),
		).toBeNull()
	})

	test("a phase lock wins over everything else", () => {
		expect(
			bomUndoBlock({
				current: synced,
				latest: { action: AuditAction.ADMIN_SYNC_BOM, id: "a1" },
				lock: "The design week is decided, so the parts list is final",
				requestedId: "a1",
				synced,
			}),
		).toBe("The design week is decided, so the parts list is final")
	})

	test("an older sync is refused once a newer event exists", () => {
		expect(
			bomUndoBlock({
				current: synced,
				latest: { action: AuditAction.ADMIN_SYNC_BOM, id: "newer" },
				lock: null,
				requestedId: "a1",
				synced,
			}),
		).toBe("Only the most recent parts list sync can be undone")
	})

	test("a sync that has already been undone is refused", () => {
		expect(
			bomUndoBlock({
				current: [],
				latest: { action: AuditAction.ADMIN_UNDO_BOM_SYNC, id: "a1" },
				lock: null,
				requestedId: "a1",
				synced,
			}),
		).toBe("Only the most recent parts list sync can be undone")
	})

	test("a list edited since the sync is refused, so the maker's edit is not overwritten", () => {
		expect(
			bomUndoBlock({
				current: [resistor],
				latest: { action: AuditAction.ADMIN_SYNC_BOM, id: "a1" },
				lock: null,
				requestedId: "a1",
				synced,
			}),
		).toBe("The parts list has changed since that sync, so it cannot be put back")
	})

	test("a sync with no readable snapshot is refused rather than guessed at", () => {
		expect(
			bomUndoBlock({
				current: synced,
				latest: { action: AuditAction.ADMIN_SYNC_BOM, id: "a1" },
				lock: null,
				requestedId: "a1",
				synced: null,
			}),
		).toBe("The parts list has changed since that sync, so it cannot be put back")
	})
})
