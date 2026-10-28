import Link from "next/link"
import { Callout, EmptyState, Field, PageHeader, Panel, Select, Table } from "@/app/components/ui"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { firstValues, type SearchParamValue } from "@/lib/search-params"
import { isUploadConfigured, listUploadedObjects, UPLOAD_FOLDERS, type UploadFolder } from "@/lib/uploads/r2"

export const dynamic = "force-dynamic"

interface Search {
	cursor?: SearchParamValue
	folder?: SearchParamValue
}
interface Props {
	searchParams: Promise<Search>
}

const FOLDER_LABELS: Record<UploadFolder, string> = {
	covers: "Cover images",
	posts: "Reels",
	sessions: "Session evidence",
	shop: "Shop images",
	timelapses: "Timelapses",
}

const modifiedFormat = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeStyle: "short",
})

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	const units = ["KB", "MB", "GB", "TB"]
	let value = bytes / 1024
	let [unit] = units
	for (let i = 1; i < units.length && value >= 1024; i++) {
		value /= 1024
		unit = units[i]
	}
	return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`
}

function keyParts(key: string): { folder: string; owner: string } {
	const [folder = "", owner = ""] = key.split("/")
	return { folder, owner }
}

export default async function AdminUploadsPage({ searchParams }: Props) {
	await requirePermissionPage(Permission.VIEW_UPLOADS)
	// The folder filter and the page cursor, each taken as the single value the URL named: a repeated parameter arrives as an array, and the bucket listing expects one string.
	const search = firstValues(await searchParams)
	const folder = UPLOAD_FOLDERS.find(value => value === search.folder)
	const prefix = folder ? `${folder}/` : ""

	let listing: Awaited<ReturnType<typeof listUploadedObjects>> | null = null
	let listError: string | null = null
	if (isUploadConfigured())
		try {
			listing = await listUploadedObjects({ cursor: search.cursor, limit: 100, prefix })
		} catch (err) {
			console.error("[admin] failed to list uploads:", err)
			listError = "The upload bucket could not be listed. Check its S3 configuration and credentials."
		}

	const pageHref = (cursor?: string) => {
		const params = new URLSearchParams()
		if (folder) params.set("folder", folder)
		if (cursor) params.set("cursor", cursor)
		const query = params.toString()
		return query ? `/admin/uploads?${query}` : "/admin/uploads"
	}

	return (
		<div className="hl-stack">
			<PageHeader subtitle="Every object currently in the R2 bucket. This page is read-only." title="Uploads" />

			<Panel>
				<form className="hl-row" method="get" style={{ alignItems: "center", flexWrap: "wrap" }}>
					<Field label="Folder">
						<Select defaultValue={folder ?? ""} name="folder" style={{ maxWidth: "16rem" }}>
							<option value="">All folders</option>
							{UPLOAD_FOLDERS.map(value => (
								<option key={value} value={value}>
									{FOLDER_LABELS[value]}
								</option>
							))}
						</Select>
					</Field>
					<button className="hl-btn" type="submit">
						Filter
					</button>
					<Link className="hl-hint" href="/admin/uploads">
						Reset
					</Link>
				</form>
				<span className="hl-hint">Showing up to 100 objects per page. Older objects continue on the next page.</span>
			</Panel>

			{!isUploadConfigured() ? (
				<Callout tone="warning">File uploads are not configured on this deployment.</Callout>
			) : listError ? (
				<Callout tone="danger">{listError}</Callout>
			) : listing && listing.objects.length === 0 ? (
				<EmptyState>No uploaded objects match this folder.</EmptyState>
			) : listing ? (
				<Panel>
					<Table head={["Key", "Folder", "Owner", "Size", "Modified", "File"]}>
						{listing.objects.map(object => {
							const parts = keyParts(object.key)
							return (
								<tr key={object.key}>
									<td className="hl-mono" style={{ overflowWrap: "anywhere" }}>
										{object.key}
									</td>
									<td>{parts.folder || "-"}</td>
									<td className="hl-mono" style={{ overflowWrap: "anywhere" }}>
										{parts.owner || "-"}
									</td>
									<td className="hl-mono">{formatBytes(object.size)}</td>
									<td className="hl-mono">{object.lastModified ? modifiedFormat.format(object.lastModified) : "-"}</td>
									<td>
										{object.url ? (
											<a href={object.url} rel="noreferrer" target="_blank">
												Open
											</a>
										) : (
											<span className="hl-hint">not public</span>
										)}
									</td>
								</tr>
							)
						})}
					</Table>
					{listing.nextCursor ? (
						<p>
							<Link href={pageHref(listing.nextCursor)}>Next page</Link>
						</p>
					) : null}
				</Panel>
			) : null}
		</div>
	)
}
