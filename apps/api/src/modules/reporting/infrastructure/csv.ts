export type Cell = string | number | boolean | null;

/** CSV « Excel francophone » : séparateur `;`, BOM UTF-8, guillemets doublés. */
export function toCsv(
  columns: { key: string; label: string }[],
  rows: Record<string, Cell>[],
): string {
  const cell = (v: Cell) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'boolean' ? (v ? 'oui' : 'non') : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const bom = '\uFEFF';
  const lines = [columns.map((c) => cell(c.label)).join(';')];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c.key] ?? null)).join(';'));
  return `${bom}${lines.join('\n')}\n`;
}
