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
	{ label: string; missing: string; extensions?: readonly string[]; pattern?: RegExp }
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
		],
	},
	logicSchematic: {
		label: "Schematic",
		missing: "No schematic found – KiCad, Logisim (.circ) or Digital (.dig) files all count",
		extensions: [".kicad_sch", ".kicad_pro", ".kicad_pcb", ".sch", ".schdoc", ".esch", ".fzz", ".circ", ".dig"],
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
	// A PCB week's board has to do something, so the code that runs on it is part of the hand-in, not an extra.
	[Theme.PCB]: { required: ["pcbSource", "firmware"], recommended: ["pcbFab", "bom"] },
	[Theme.CAD]: { required: ["cadSource"], recommended: ["cadModel"] },
	[Theme.SYNTH]: { required: ["logicSchematic"], recommended: ["firmware"] },
	[Theme.DISPLAYS]: { required: ["firmware"], recommended: ["logicSchematic"] },
	[Theme.BREADBOARD_COMPUTER]: { required: ["logicSchematic"], recommended: [] },
	// A warm-up project is any hardware project, so nothing over and above the README and photos every hand-in owes (see lib/repo-checks) is demanded of its repo.
	[Theme.WARMUP]: { required: [], recommended: [] },
}
