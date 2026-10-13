import { Theme } from "@/app/generated/prisma/enums"

/**
 * What a project's repo has to contain before its week can be handed in.
 *
 * Ported from Hack Club Stasis's pre-submission checks, with one difference: Stasis asks the maker what kind of project it is, and Half Life already knows, because every week has a theme. So the file requirements are keyed by theme here rather than ticked on a form.
 *
 * Every theme needs a public repo with a README that has photos in it – that is what a reviewer opens first. On top of that, each theme names:
 * - `required`: file kinds that block submitting when none are found. These are the files the week exists to produce.
 * - `recommended`: file kinds worth having, reported to the maker and the reviewer but never blocking.
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
 * - Standard edition writes one JSON document whose `head` carries a numeric `docType`: 1 schematic, 3 board, 5 a multi-sheet schematic project.
 * - Pro edition writes a log of `||`-joined records whose header record carries a named one: `PCB`, `SCH`, `SCH_PAGE`, `BOARD`.
 *
 * Library types are deliberately absent – a footprint, symbol or device library is not a design of anything – and Standard's bare numbers, which could belong to anything, are only accepted alongside `editorVersion` or `canvas`, which nothing else writes there.
 */
export const DESIGN_JSON = Object.freeze({
	/** The extension to look for. Far too common to accept unread. */
	extension: ".json",
	/** How much of the file to look at: either format names the document at the very top. */
	headerChars: 8192,
	/** The document type, as either format spells it, wherever in the opening it sits. */
	docType: /"docType"\s*:\s*"([^"]{1,24})"/i,
	/** Pro's names, lowercased – they say what the document is on their own. */
	named: new Set(["sch", "pcb", "sch_page", "board"]),
	/** Standard's numbers: 1 schematic, 3 board, 5 schematic project. */
	numeric: new Set(["1", "3", "5"]),
	/** Something else from the same editor, which a bare number in the wild does not carry. */
	fingerprint: /"editorVersion"|"canvas"/i,
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
	pcbSource: {
		label: "PCB design files",
		missing: "No board or schematic files (.kicad_pcb, .kicad_sch, .brd, EasyEDA…) found",
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
	},
	pcbFab: {
		label: "Fabrication files",
		missing: "No Gerber or drill files (or a zip of them) found",
		// A .zip counts, as in Stasis: most fab houses take the Gerbers as one zipped export, and that is often all a repo carries.
		extensions: [".gbr", ".gbl", ".gtl", ".gbs", ".gts", ".gbo", ".gto", ".gko", ".drl", ".zip"],
	},
	cadSource: {
		label: "CAD source files",
		missing: "No editable CAD files (.step, .f3d, .scad, .fcstd…) found",
		extensions: [".f3d", ".step", ".stp", ".fcstd", ".scad", ".blend", ".sldprt", ".sldasm", ".iges", ".igs"],
	},
	cadModel: {
		label: "Printable models",
		missing: "No printable models (.stl, .3mf, .obj) found",
		extensions: [".stl", ".obj", ".3mf"],
	},
	firmware: {
		label: "Firmware",
		missing:
			"No firmware found – Arduino (.ino), C/C++, MicroPython or CircuitPython (.py), Rust and the like all count",
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
	},
	logicSchematic: {
		label: "Schematic",
		missing: "No schematic found – KiCad, Logisim (.circ), Digital (.dig) or an exported EasyEDA file all count",
		extensions: [".kicad_sch", ".kicad_pro", ".kicad_pcb", ".sch", ".schdoc", ".esch", ".fzz", ".circ", ".dig"],
		json: DESIGN_JSON,
	},
	bom: {
		label: "BOM CSV",
		missing: "No bom*.csv found",
		pattern: BOM_CSV_PATTERN,
	},
}

export const THEME_REPO_REQUIREMENTS: Record<
	Theme,
	{ required: readonly RepoFileKind[]; recommended: readonly RepoFileKind[] }
> = {
	// The board files are the week. Firmware is recommended rather than required: an analogue board – a preamp, a power supply, a sensor front end – has nothing to flash, and asking one for code it will never run turned a finished analogue project into a hand-in the checks refused.
	[Theme.PCB]: { required: ["pcbSource"], recommended: ["pcbFab", "bom", "firmware"] },
	[Theme.CAD]: { required: ["cadSource"], recommended: ["cadModel"] },
	[Theme.SYNTH]: { required: ["logicSchematic"], recommended: ["firmware"] },
	[Theme.DISPLAYS]: { required: ["firmware"], recommended: ["logicSchematic"] },
	[Theme.BREADBOARD_COMPUTER]: { required: ["logicSchematic"], recommended: [] },
	// A warm-up project is any hardware project, so nothing over and above the README and photos every hand-in owes (see lib/repo-checks) is demanded of its repo.
	[Theme.WARMUP]: { required: [], recommended: [] },
}
