/**
 * Writes `src/lib/enums.ts` from the emitted Prisma 8 contract.
 *
 * Prisma 8 has no generated `enums.ts`. The contract carries each enum as a `valueSet`, and `db.nativeEnums` exposes it as `{ members, names, values }` – not the `Phase.DESIGN` shape the app reads in ~100 files, including browser code that must not import the contract runtime. This emits that shape once, as a plain module both sides can import.
 *
 * Run through `bun run p8:contract:emit`, after `prisma contract emit`.
 */
import { readFile, writeFile } from "node:fs/promises"

const contractPath = "src/app/generated/prisma8/contract.json"
const outputPath = "src/lib/enums.ts"

interface ValueSet {
	kind: "valueSet"
	values: readonly string[]
}

interface Contract {
	storage: {
		namespaces: {
			public: {
				entries: {
					valueSet: { [_: string]: ValueSet }
				}
			}
		}
	}
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- verification script over an untyped source
const contract = JSON.parse(await readFile(contractPath, "utf8")) as Contract
const valueSets = contract.storage.namespaces.public.entries.valueSet
const names = Object.keys(valueSets).toSorted()

const blocks = names.map(name => {
	const members = valueSets[name]?.values ?? []
	const properties = members.map(member => `\t${member}: "${member}",`).join("\n")
	return `export const ${name} = {\n${properties}\n} as const satisfies { [K in Members<"${name}">]: K }\n\nexport type ${name} = (typeof ${name})[keyof typeof ${name}]`
})

const file = `/**
 * The schema's enums, as values rather than types.
 *
 * Prisma 8 has no generated \`enums.ts\`: the contract knows each enum as a \`valueSet\`, and \`db.nativeEnums\` exposes it as \`{ members, names, values }\` rather than the \`Phase.DESIGN\` shape the app reads. This module keeps that shape for one import that works on both sides of the client boundary, since the contract runtime is a server dependency.
 *
 * Generated from \`prisma/contract.prisma\` by \`scripts/generate-enums.ts\` – run \`bun run db:generate\` after changing the schema. The \`satisfies\` check fails typecheck if this file and the contract disagree.
 */
import type { Contract } from "@/app/generated/prisma8/contract.d"

// A value and a type of the same name are the whole point of this module: call sites read \`Phase.DESIGN\` and annotate \`: Phase\` from one import, as they did with the generated file. Declaration merging is legal TypeScript, so the duplicate-declaration rule is off for the emitted names.
// oxlint-disable eslint/no-redeclare

type ValueSets = Contract["storage"]["namespaces"]["public"]["entries"]["valueSet"]

type Members<N extends keyof ValueSets> =
	ValueSets[N] extends { readonly values: readonly (infer V extends string)[] } ? V : never

${blocks.join("\n\n")}
`

await writeFile(outputPath, file)
console.log(`wrote ${names.length} enums to ${outputPath}`)
