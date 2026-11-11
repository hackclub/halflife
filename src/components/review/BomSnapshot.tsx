import { formatDollars } from "@/components/review/format"
import { SafeLink } from "@/components/review/ui"
import type { BomLine } from "@/lib/bom-schema"

/**
 * The design's parts list, in Fabricate's BOM table. Frozen while the phase is in review, so it is what the grant is priced from.
 *
 * Fabricate's cart-screenshot matching column is gone with the AI cart check that filled it.
 */
export function BomSnapshot({ lines, taxShippingUsd }: { lines: BomLine[]; taxShippingUsd: number }) {
	const parts = lines.reduce((sum, line) => sum + line.quantity * line.unitCostUsd, 0)
	return (
		<div className="field__hint">
			<p>
				Half Life BOM · {formatDollars(parts + taxShippingUsd)}
				{taxShippingUsd > 0 ? ` (${formatDollars(taxShippingUsd)} tax and shipping)` : ""}
			</p>
			<div className="table-wrap">
				<table className="table bom-table">
					<thead>
						<tr>
							<th>Part</th>
							<th className="num">Qty</th>
							<th className="num">Cost</th>
							<th>Link</th>
						</tr>
					</thead>
					<tbody>
						{lines.map(line => (
							<tr key={line.id}>
								<td>
									{line.name}
									{line.purpose ? <span className="field__hint"> · {line.purpose}</span> : null}
								</td>
								<td className="num">{line.quantity}</td>
								<td className="num">{formatDollars(line.quantity * line.unitCostUsd)}</td>
								<td className="bom-table__link">
									{line.link ? <SafeLink href={line.link}>{line.vendor ?? undefined}</SafeLink> : (line.vendor ?? "—")}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	)
}
