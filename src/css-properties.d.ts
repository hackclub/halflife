import "react"

/**
 * Custom properties in `CSSProperties`.
 *
 * A `style` prop is typed as `CSSProperties`, which names only the standard properties, so a literal like `{ "--sk-radius": "16px" }` was not assignable to it and every call site asserted the type. The DOM accepts custom properties exactly like any other style property, so this widens the interface to match: only `--*` names, with values a style value may have. Standard properties keep their checks.
 */
declare module "react" {
	interface CSSProperties {
		[key: `--${string}`]: string | number | undefined
	}
}
