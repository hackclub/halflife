/**
 * The review file viewer's public surface, as the main type-check sees it.
 *
 * `src/components/review/hurt` is a copy of Fabricate's file viewer, kept faithful so it can be re-copied, and type-checked under Fabricate's own compiler settings by `tsconfig.hurt.json`. The main tsconfig excludes it, and `turbopack.resolveAlias` in next.config.ts points this specifier at the real module. Keep this in step with `hurt/Hurt.tsx` and `hurt/core/prefetch.ts`.
 */
declare module "@review/hurt" {
	import type { ComponentType, ReactNode } from "react"

	const Hurt: ComponentType<{ repo?: string; shipId?: string | null; tools?: ReactNode }>
	export default Hurt
	export function preprocessShip(shipId: string, rank?: number): Promise<void>
}
