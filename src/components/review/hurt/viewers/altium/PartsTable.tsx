export default function PartsTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  if (rows.length === 0) return <p className="hurt-empty">This file lists no parts.</p>
  const used = columns.map((_, i) => rows.some((row) => row[i]))
  return (
    <div className="hurt-table__scroll">
      <table className="hurt-grid">
        <thead>
          <tr>
            <th />
            {columns.map((c, i) => used[i] && <th key={c}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              <td className="hurt-grid__n">{r + 1}</td>
              {columns.map((c, i) => used[i] && <td key={c}>{row[i] ?? ''}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
