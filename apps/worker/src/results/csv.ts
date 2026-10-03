export function csvCell(value: string | number): string {
 let text = String(value);
 // Quote alone does not stop spreadsheet formulas. Protect untrusted text even after whitespace/control prefixes.
 if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = "'" + text;
 return '"' + text.replaceAll('"', '""') + '"';
}
export function csvRows(rows: (string | number)[][]): string {
 return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
