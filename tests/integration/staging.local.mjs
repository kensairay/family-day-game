import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from './migrations.mjs';
const host = 'family-day-game-staging.example.workers.dev', base = 'https://' + host;
const bundle = await build({ entryPoints: ['apps/worker/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
const bindings = { ADMIN_SECRET: 'staging-local-only-long-secret', PUBLIC_DEPLOYMENT: 'true', DEPLOYMENT_ENV: 'staging', STAGING_HOSTNAME: host, TURNSTILE_MODE: 'test', TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET: '1x0000000000000000000000000000000AA', DEPLOYMENT_REVISION: 'test-revision' };
let validations = 0;
const options = config => convertV4MiniflareOptions({
 name: 'staging-security-test', modules: true, script: bundle.outputFiles[0].text, cf: false, compatibilityDate: '2026-10-01', bindings: config,
 durableObjects: { ROOMS: { className: 'GameRoom', useSQLite: true }, DIRECTORY: { className: 'RoomDirectory', useSQLite: true } },
 d1Databases: { DB: 'staging-local-db' }, serviceBindings: { ASSETS: () => new Response('test asset') },
 outboundService: async req => {
  assert.equal(req.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify'); validations++;
  const data = await req.json(); assert.equal(data.secret, bindings.TURNSTILE_SECRET);
  return Response.json(data.response === 'XXXX.DUMMY.TOKEN.XXXX' ? { success: true, hostname: 'localhost', action: 'test' } : { success: false });
 },
});
const mf = new Miniflare(options(bindings));
let cookie;
const call = (path, method = 'GET', data) => mf.dispatchFetch(base + path, {
 method, headers: { ...(method === 'GET' ? {} : { Origin: base, 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
 ...(data === undefined ? {} : { body: JSON.stringify(data) }),
});
async function ok(path, method, data, status = 200) { const response = await call(path, method, data); assert.equal(response.status, status, path); return response.json(); }
try {
 await applyMigrations(await mf.getD1Database('DB', 'staging-security-test'));
 const config = await ok('/api/config'); assert.equal(config.environment, 'staging'); assert.equal(config.turnstileMode, 'test'); assert.equal(config.deploymentRevision, 'test-revision');
 assert.equal((await call('/api/admin/banks')).status, 401);
 const login = await call('/api/admin/login', 'POST', { password: bindings.ADMIN_SECRET }); assert.equal(login.status, 200);
 assert.match(login.headers.get('Set-Cookie'), /; Secure/); cookie = login.headers.get('Set-Cookie').split(';')[0];
 const questions = [1,2,3].map(round => ({ id: 'stage-'+round, round, text: '測試'+round, options: ['甲','乙'], correct: 0, seconds: 120, points: 10 }));
 const bank = await ok('/api/admin/banks', 'POST', { title: 'Staging測試', description: '', questions }, 201);
 const published = await ok(`/api/admin/banks/${bank.id}/publish`, 'POST', { revision: bank.revision });
 const room = await ok('/api/rooms', 'POST', { bankId: bank.id, publishedRevision: published.publishedRevision }, 201);
 assert.equal((await call(`/api/rooms/${room.roomId}/join`, 'POST', { nickname: '無token' })).status, 403);
 assert.equal((await call(`/api/rooms/${room.roomId}/join`, 'POST', { nickname: '錯token', challenge: 'bad' })).status, 403);
 await ok(`/api/rooms/${room.roomId}/join`, 'POST', { nickname: '測試玩家', challenge: 'XXXX.DUMMY.TOKEN.XXXX' }, 201);
 assert.equal(validations, 2, '有效與無效token都送Siteverify，無token不送');
 // Existing rooms keep their stored question version, but old synthetic E2E
 // script literals must no longer appear in host/player snapshots.
 const legacyQuestions = [1,2,3].map(round => ({ id: 'legacy-'+round, round, text: `<script>window.injection = true</script> 第${round}題`, options: ['答案A','答案B'], correct: 1, seconds: 120, points: 260 }));
 const legacy = await ok('/api/admin/banks', 'POST', { title: 'E2E題庫-1791170000000', description: '', questions: legacyQuestions }, 201);
 const legacyPublished = await ok(`/api/admin/banks/${legacy.id}/publish`, 'POST', { revision: legacy.revision });
 const legacyRoom = await ok('/api/rooms', 'POST', { bankId: legacy.id, publishedRevision: legacyPublished.publishedRevision }, 201);
 const socket = await mf.dispatchFetch(base + `/api/rooms/${legacyRoom.roomId}/socket`, { headers: { Origin: base, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'family.v1, auth.' + legacyRoom.hostToken } });
 assert.equal(socket.status, 101);
 const ws = socket.webSocket;
 const snapshot = (phase) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('舊測試房間快照逾時')), 3000);
  const listener = event => { const message = JSON.parse(event.data); if (message.type === 'state.snapshot' && (!phase || message.phase === phase)) { clearTimeout(timer); ws.removeEventListener('message', listener); resolve(message); } };
  ws.addEventListener('message', listener);
 });
 const initial = snapshot(); ws.accept(); const lobby = await initial;
 const opened = snapshot('QUESTION_OPEN');
 ws.send(JSON.stringify({ protocol: 1, type: 'host.command', action: 'start', commandId: crypto.randomUUID(), expectedVersion: lobby.version }));
 const display = await opened; ws.close();
 assert.equal(display.question.text, '第1題'); assert.equal(display.question.id, 'legacy-1'); assert.equal(display.question.points, 260);
 assert.deepEqual((await ok(`/api/admin/banks/${legacy.id}`)).questions, legacyQuestions, '保留原始題庫版本');
 assert.equal((await mf.dispatchFetch('http://' + host + '/api/config')).status, 403);
} finally { await mf.dispose(); }
for (const config of [{ ...bindings, DEPLOYMENT_ENV: 'production' }, { ...bindings, STAGING_HOSTNAME: 'other.workers.dev' }, { ...bindings, TURNSTILE_MODE: 'real' }]) {
 const invalid = new Miniflare(options(config));
 try { assert.equal((await invalid.dispatchFetch(base + '/api/config')).status, 503, '錯誤測試設定須拒絕'); }
 finally { await invalid.dispose(); }
}
console.log('PASS: HTTPS Staging設定、Secure Cookie、發布題庫、有效／無效Turnstile token、Siteverify呼叫、HTTP拒絕、正式環境測試金鑰拒絕');
