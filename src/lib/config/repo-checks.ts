import { Theme } from "@/lib/enums"

/**
 * What a project's repo has to contain before its week can be handed in.
 *
 * Ported from Hack Club Stasis's pre-submission checks, with one difference: Stasis asks the maker what kind of project it is, and Half Life already knows, because every week has a theme. So the file requirements are keyed by theme here rather than ticked on a form.
 *
 * Every theme needs a public repo with a README that has enough text and photos in it – that is what a reviewer opens first. On top of that, each theme names:
 *
 * - `required`: file kinds that block submitting when none are found. These are the files the week exists to produce.
 *
 * - `recommended`: file kinds worth having, reported to the maker and the reviewer but never blocking.
 *
 * - `bomTable`: the README should carry a BOM table a reviewer can price. `minRows` is 2 for a board plus its parts, 1 for a printed material or part. This is a warning, not a submit gate.
 *
 * Changing what a theme asks for is this table and nothing else.
 */

/**
 * The file the BOM import looks for, and what the repo check calls a BOM CSV.
 *
 * Strict on purpose, as Stasis has it: "parts.csv" matching would tell a reviewer there is a BOM when there may not be one. Shared here so the check and the import find the same file.
 */
export const BOM_CSV_PATTERN = /(^|\/)[^/]*bom[^/]*\.csv$/i

/**
 * How a `.json` in the repo can stand in for a board or a schematic.
 *
 * EasyEDA – and JLCPCB, which is the same editor – export a design as JSON, and for plenty of makers that export is the only copy of the board in the repo. But `.json` is also every package manifest, lockfile and tsconfig in every firmware repo, so the extension on its own proves nothing: a repo whose "PCB design file" is its `package.json` has not designed a board. The file's name cannot settle it either, since a design may be called `board.json`, `main.json` or anything else. So a `.json` counts only once it has been read and has said what it is.
 *
 * Both formats name the document in the opening, which is all that is read – a design can run to megabytes of compressed shape data:
 *
 * - Standard edition writes one JSON document whose `head` carries a numeric `docType`: 1 schematic, 3 board, 5 a multi-sheet schematic project.
 *
 * - Pro edition writes a log of `||`-joined records whose header record carries a named one: `PCB`, `SCH`, `SCH_PAGE`, `BOARD`.
 *
 * Library types are deliberately absent – a footprint, symbol or device library is not a design of anything – and Standard's bare numbers, which could belong to anything, are only accepted alongside `editorVersion` or `canvas`, which nothing else writes there.
 */
export const DESIGN_JSON = Object.freeze({
	/** The document type, as either format spells it, wherever in the opening it sits. */
	docType: /"docType"\s*:\s*"([^"]{1,24})"/i,
	/** The extension to look for. Far too common to accept unread. */
	extension: ".json",
	/** Something else from the same editor, which a bare number in the wild does not carry. */
	fingerprint: /"editorVersion"|"canvas"/i,
	/** How much of the file to look at: either format names the document at the very top. */
	headerChars: 8192,
	/** Pro's names, lowercased – they say what the document is on their own. */
	named: new Set(["sch", "pcb", "sch_page", "board"]),
	/** Standard's numbers: 1 schematic, 3 board, 5 schematic project. */
	numeric: new Set(["1", "3", "5"]),
})

export type RepoFileKind =
	| "pcbSource" // board and schematic sources
	| "pcbFab" // gerbers and drill files
	| "cadSource" // editable 3D sources
	| "cadModel" // printable meshes
	| "firmware"
	| "logicSchematic" // schematics, plus logic-simulator files
	| "bom"

export const REPO_FILE_KINDS: Record<
	RepoFileKind,
	{
		label: string
		missing: string
		extensions?: readonly string[]
		pattern?: RegExp
		/** Set for the kinds a read design file can satisfy too – see DESIGN_JSON. */
		json?: typeof DESIGN_JSON
	}
> = {
	bom: {
		label: "BOM CSV",
		missing: "No bom*.csv found",
		pattern: BOM_CSV_PATTERN,
	},
	cadModel: {
		// A printable mesh is a deliverable for the print, never a substitute for the editable source below. STL-only submissions fail the source check, which is the policy.
		extensions: [".stl", ".obj", ".3mf"],
		label: "Printable models",
		missing: "No printable models (.stl, .3mf, .obj) found",
	},
	cadSource: {
		// The editable source from a CAD tool the program accepts. OpenSCAD and Blender are deliberately absent: reviewers return them, and Tinkercad has no source file at all – it exports a mesh. A .stl/.obj/.3mf is a printable model, not a source.
		extensions: [".f3d", ".f3z", ".step", ".stp", ".fcstd", ".sldprt", ".sldasm", ".iges", ".igs"],
		label: "CAD source files",
		missing:
			"No editable CAD source found. Tinkercad, OpenSCAD, Blender and STL-only exports are not accepted as the source. Export an editable file from Fusion, Onshape, FreeCAD or SolidWorks (.step, .f3d, .fcstd, .sldprt…).",
	},
	firmware: {
		// .mpy is precompiled MicroPython/CircuitPython; .uf2/.hex/.bin are built images, which count when the source lives elsewhere.
		extensions: [
			".ino",
			".c",
			".cc",
			".cpp",
			".cxx",
			".h",
			".hh",
			".hpp",
			".py",
			".mpy",
			".rs",
			".ts",
			".js",
			".uf2",
			".hex",
			".bin",
			".go",
		],
		label: "Firmware",
		missing:
			"No firmware found. Arduino (.ino), C/C++, MicroPython or CircuitPython (.py), Rust and the like all count",
	},
	logicSchematic: {
		extensions: [".kicad_sch", ".kicad_pro", ".kicad_pcb", ".sch", ".schdoc", ".esch", ".fzz", ".circ", ".dig"],
		json: DESIGN_JSON,
		label: "Schematic",
		missing: "No schematic found. KiCad, Logisim (.circ), Digital (.dig) or an exported EasyEDA file all count",
	},
	pcbFab: {
		// A .zip counts, as in Stasis: most fab houses take the Gerbers as one zipped export, and that is often all a repo carries.
		extensions: [".gbr", ".gbl", ".gtl", ".gbs", ".gts", ".gbo", ".gto", ".gko", ".drl", ".zip"],
		label: "Fabrication files",
		missing: "No Gerber or drill files (or a zip of them) found",
	},
	pcbSource: {
		extensions: [
			".kicad_pcb",
			".kicad_sch",
			".kicad_pro",
			".brd",
			".sch",
			".pcbdoc",
			".schdoc",
			".fzz",
			".fzpz",
			".epcb",
			".epro",
			".epro2",
			".eprj",
			".esch",
		],
		json: DESIGN_JSON,
		label: "PCB design files",
		missing: "No board or schematic files (.kicad_pcb, .kicad_sch, .brd, EasyEDA…) found",
	},
}

export const THEME_REPO_REQUIREMENTS: Record<
	Theme,
	{
		/** The README BOM table the check suggests, when the week's funding is priced from it. */
		bomTable?: { minRows: number }
		recommended: readonly RepoFileKind[]
		required: readonly RepoFileKind[]
	}
> = {
	// The board files are the week, and the BOM is what the parts funding is asked against – a design week hands in a cart to be funded, so a repo without its parts list is a hand-in a reviewer cannot price. Firmware is recommended rather than required: an analogue board – a preamp, a power supply, a sensor front end – has nothing to flash, and asking one for code it will never run turned a finished analogue project into a hand-in the checks refused.
	[Theme.PCB]: { bomTable: { minRows: 2 }, recommended: ["pcbFab", "firmware"], required: ["pcbSource", "bom"] },
	// A CAD week is a printed part, so one material row is a complete BOM; a board week also has the board itself, so two rows is the floor there.
	[Theme.CAD]: { bomTable: { minRows: 1 }, recommended: ["cadModel"], required: ["cadSource"] },
	[Theme.SYNTH]: { recommended: ["firmware"], required: ["logicSchematic"] },
	[Theme.DISPLAYS]: { recommended: ["logicSchematic"], required: ["firmware"] },
	[Theme.BREADBOARD_COMPUTER]: { recommended: [], required: ["logicSchematic"] },
	// A warm-up project is any hardware project, so nothing over and above the README and photos every hand-in owes (see lib/repo-checks) is demanded of its repo.
	[Theme.WARMUP]: { recommended: [], required: [] },
}

/**
 * Whether the maker's confirmation that their project has no microcontroller clears the repo's blocking checks.
 *
 * Displays requires firmware because most of its projects drive one; a display built from logic or mechanisms has none to hand in. Only firmware can be waived, and only when nothing else is blocking, so the box cannot skip the README, the photos or the schematic.
 */
export function firmwareWaiverCovers(theme: Theme, blocking: readonly { key: string }[], confirmed: boolean): boolean {
	return (
		confirmed && theme === Theme.DISPLAYS && blocking.length > 0 && blocking.every(check => check.key === "firmware")
	)
}

/**
 * The columns that make a README table a BOM a reviewer can price.
 *
 * A part-like column alone is a parts list; a price, cost, link or supplier column is what turns it into a BOM the funding can be checked against. Quantity is useful but a table with only `Part | Qty` still leaves the reviewer with no price to check, so it does not count on its own.
 */
const BOM_PART_COLUMN = /\b(?:part|component|item|description|material|product)\b/
const BOM_PRICE_COLUMN = /\b(?:price|cost|link|url|supplier|vendor|total|amount)\b/

/**
 * A Markdown table's separator row: one or more dashes per column, with optional alignment colons.
 *
 * GFM asks for at least one dash, not three, so `| --: |` is a real right-aligned column and GitHub renders it as one. Requiring three rejected those tables as if the README had no BOM.
 */
const TABLE_SEPARATOR = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/

/** The cells of a Markdown table row, lowercased, with the outer pipes removed. */
function tableCells(line: string): string[] {
	return line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map(cell => cell.trim().toLowerCase())
}

/** Whether a row of header cells names the two halves a BOM table needs. */
function isBomHeader(cells: readonly string[]): boolean {
	return (
		cells.length >= 2
		&& cells.some(cell => BOM_PART_COLUMN.test(cell))
		&& cells.some(cell => BOM_PRICE_COLUMN.test(cell))
	)
}

/**
 * The BOM table in a README, or null when there is none.
 *
 * A table is a header row, a separator row, then at least `minimumRows` data rows. The header has to name a part-like column and a price-like column, so a pinout, a controls table or a specs table does not count. Fenced code is ignored: a CSV pasted into a code block is not a rendered table, and neither is a screenshot of one – the reviewer prices the project from the table they can read.
 *
 * Both Markdown and HTML tables are accepted, because the README may be written either way.
 */
export function readmeBomTable(readme: string, minimumRows = 1): { rows: number } | null {
	return markdownBomTable(readme, minimumRows) ?? htmlBomTable(readme, minimumRows)
}

function markdownBomTable(readme: string, minimumRows: number): { rows: number } | null {
	// Fenced code is not a rendered table, and a table in a code sample is not the README's BOM.
	const lines = readme.replaceAll(/```[\s\S]*?```/g, "").split(/\r?\n/)
	for (let i = 0; i < lines.length - 1; i += 1) {
		const header = lines[i]?.trim() ?? ""
		if (!header.includes("|")) continue
		if (!TABLE_SEPARATOR.test(lines[i + 1]?.trim() ?? "")) continue
		if (!isBomHeader(tableCells(header))) continue
		let rows = 0
		for (let j = i + 2; j < lines.length; j += 1) {
			const row = lines[j]?.trim() ?? ""
			if (!row.includes("|") || TABLE_SEPARATOR.test(row)) break
			if (tableCells(row).length >= 2) rows += 1
		}
		if (rows >= minimumRows) return { rows }
	}
	return null
}

function htmlBomTable(readme: string, minimumRows: number): { rows: number } | null {
	for (const table of readme.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
		const rows = [...table[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map(row => row[0])
		if (rows.length < minimumRows + 1) continue
		const header = [...(rows[0] ?? "").matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(cell =>
			(cell[1] ?? "")
				.replaceAll(/<[^>]+>/g, " ")
				.replaceAll(/\s+/g, " ")
				.trim()
				.toLowerCase(),
		)
		if (isBomHeader(header)) return { rows: rows.length - 1 }
	}
	return null
}
