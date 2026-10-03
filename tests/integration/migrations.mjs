import { readFile, readdir } from 'node:fs/promises';
export async function applyMigrations(db) {
 for (const name of (await readdir('migrations')).filter(name => name.endsWith('.sql')).sort()) {
  const sql = await readFile('migrations/' + name, 'utf8');
  await db.batch(sql.split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
 }
}
