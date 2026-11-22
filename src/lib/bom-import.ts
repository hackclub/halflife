import "server-only"
import { type ImportedBomLine, parseBomCsv, type SkippedRow } from "@/lib/bom-csv"
import { BOM_CSV_PATTERN } from "@/lib/config/repo-checks"
import { findRepoFilePath, readRepoFile } from "@/lib/repo-checks"
import { repoRefFromLink } from "@/lib/repo-ref"
import { BOM_PATH } from "@/lib/repo-sync-files"

/**
 * Reading a project's parts list out of its repo, shared by the maker's import and the admin's repo sync.
 *
 * Both read the same file the same way, so a preview from either side means the same thing: the file that was found, and the lines it parsed to.
 */

export interface RepoBom {
	lines: ImportedBomLine[]
	path: string
	skipped: SkippedRow[]
}

/**
 * The repo's BOM CSV, found, read and parsed – or a sentence saying why not.
 *
 * `limit` is what the import may add, so the overflow is reported as skipped by the parser rather than by the caller.
 */
export async function readRepoBom(repoLink: string | null, limit: number): Promise<RepoBom | { error: string }> {
	if (!repoLink) return { error: "This project has no repo linked yet. Add one, then import." }

	if (!repoRefFromLink(repoLink))
		return {
			error:
				"Half Life can only read repos on GitHub or GitLab. This project's repo is on another service, so its parts have to be added by hand.",
		}

	// The sync owns BOM.csv at the repo root. When the maker's own export sits beside it, read that instead: the generated copy can only echo what the platform already holds.
	const path = await findRepoFilePath(repoLink, BOM_CSV_PATTERN, { avoid: BOM_PATH })
	if (!path)
		return {
			error: "No bom*.csv file was found in the repo. Export one from your design tool and push it, then try again.",
		}

	const csv = await readRepoFile(repoLink, path)
	if (csv === null)
		return {
			error: `Could not read ${path} from the repo. It may be too large, or on a service Half Life cannot read.`,
		}

	const parsed = parseBomCsv(csv, { limit })
	if (!parsed.header)
		return { error: `${path} does not look like a BOM table: no header row with part names was found.` }

	return { lines: parsed.lines, path, skipped: parsed.skipped }
}
