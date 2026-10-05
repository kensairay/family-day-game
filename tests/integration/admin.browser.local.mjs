import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applyMigrations } from './migrations.mjs';

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
 const db = await mf.getD1Database('DB', 'admin-browser-test'); await applyMigrations(db);
 const url = await mf.ready;
 for (const script of ['admin.e2e.cjs', 'lobby.e2e.cjs']) {
  const result = await promisify(execFile)(process.execPath, ['tests/integration/' + script], { env: { ...process.env, TEST_URL: url.origin, TEST_ADMIN_SECRET: secret, TEST_USE_PUBLISHED_BANK: 'true' }, timeout: 120000 });
  process.stdout.write(result.stdout);
 }
} catch (error) {
 process.stderr.write(error.stderr || error.message); process.exitCode = 1;
} finally { await mf.dispose(); }
