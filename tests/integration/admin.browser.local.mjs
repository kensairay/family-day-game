import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// No production data or Cloudflare account is used. Each run gets a fresh D1/DO runtime.
const secret = 'local-test-only-very-long-secret';
const root = resolve('apps/web/build');
const bundle = await build({ entryPoints: ['apps/worker/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
const mf = new Miniflare(convertV4MiniflareOptions({
 name: 'admin-browser-test', modules: true, script: bundle.outputFiles[0].text, cf: false, compatibilityDate: '2026-10-01',
 bindings: { ADMIN_SECRET: secret }, d1Databases: { DB: 'browser-test-db' },
 durableObjects: { ROOMS: { className: 'GameRoom', useSQLite: true }, DIRECTORY: { className: 'RoomDirectory', useSQLite: true } },
 serviceBindings: { ASSETS: async req => {
  const path = new URL(req.url).pathname; const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(root + sep)) return new Response('Not found', { status: 404 });
  try {
   const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[extname(file)] ?? 'application/octet-stream';
   return new Response(await readFile(file), { headers: { 'Content-Type': mime } });
  } catch { return new Response('Not found', { status: 404 }); }
 } },
}));
try {
 const db = await mf.getD1Database('DB', 'admin-browser-test'); const sql = await readFile('migrations/0001_question_banks.sql', 'utf8');
 await db.batch(sql.split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
 const url = await mf.ready;
 const result = await promisify(execFile)(process.execPath, ['tests/integration/admin.e2e.cjs'], { env: { ...process.env, TEST_URL: url.origin, TEST_ADMIN_SECRET: secret }, timeout: 60000 });
 process.stdout.write(result.stdout);
} finally { await mf.dispose(); }
