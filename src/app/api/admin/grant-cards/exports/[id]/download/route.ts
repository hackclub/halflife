import { NextResponse } from "next/server"
import { fail } from "@/lib/api"
import { grantCardExportCsv } from "@/lib/grant-cards"
import { withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/** The exact import file a generated export held; re-downloaded after the page reloads. */
export const GET = withPermission(Permission.MANAGE_CREDIT, async (_req: Request, { params }: Params) => {
	const { id } = await params
	const file = await grantCardExportCsv(id)
	if (!file) return fail("NOT_FOUND", "Grant card export not found")
	return new NextResponse(file.csv, {
		headers: {
			"Content-Disposition": `attachment; filename="${file.filename}"`,
			"Content-Type": "text/csv; charset=utf-8",
		},
	})
})
