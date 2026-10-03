import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const secret = 'admin-local-test-only-long-password';
const bundle = await build({ entryPoints: ['apps/worker/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
const mf = new Miniflare({ ...convertV4MiniflareOptions({
 name: 'admin-test', modules: true, script: bundle.outputFiles[0].text, cf: false, compatibilityDate: '2026-10-01',
 bindings: { ADMIN_SECRET: secret, PUBLIC_DEPLOYMENT: 'true', TURNSTILE_SECRET: 'test', TURNSTILE_SITE_KEY: 'test' },
 d1Databases: { DB: 'admin-test-db' },
 durableObjects: { ROOMS: { className: 'GameRoom', useSQLite: true }, DIRECTORY: { className: 'RoomDirectory', useSQLite: true } },
 serviceBindings: { ASSETS: () => new Response('test asset') },
}), unsafeInspectDurableObjects: true });
const base = 'http://localhost'; const sockets = [];
const call = (path, method = 'GET', data, cookie, extra = {}) => mf.dispatchFetch(base + path, {
 method, headers: { ...(method === 'GET' ? {} : { Origin: base }), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...extra },
 ...(data === undefined ? {} : { body: JSON.stringify(data) }),
});
async function ok(path, method, data, cookie, status = 200) {
 const response = await call(path, method, data, cookie); const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
}
async function until(predicate) {
 const deadline = Date.now() + 3000;
 while (Date.now() < deadline) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)); }
 throw new Error('snapshot timeout');
}
try {
 const db = await mf.getD1Database('DB', 'admin-test');
 const sql = await readFile('migrations/0001_question_banks.sql', 'utf8');
 await db.batch(sql.split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
 assert.equal((await call('/api/admin/banks')).status, 401);
 assert.equal((await call('/api/admin/banks', 'POST', { title: '入侵' })).status, 401);
 assert.equal((await call('/api/admin/login', 'POST', { password: secret }, undefined, { Origin: 'https://evil.invalid' })).status, 403);
 assert.equal((await call('/api/admin/login', 'POST', { password: 'wrong' })).status, 401);
 const login = await call('/api/admin/login', 'POST', { password: secret }); assert.equal(login.status, 200);
 const setCookie = login.headers.get('Set-Cookie'); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/); assert.match(setCookie, /Max-Age=3600/);
 const cookie = setCookie.split(';')[0]; assert.equal((await call('/api/admin/session', 'GET', undefined, cookie)).status, 200);
 const publicLogin = await mf.dispatchFetch('https://game.invalid/api/admin/login', { method: 'POST', headers: { Origin: 'https://game.invalid', 'Content-Type': 'application/json', 'CF-Connecting-IP': 'public-test' }, body: JSON.stringify({ password: secret }) });
 assert.equal(publicLogin.status, 200); assert.match(publicLogin.headers.get('Set-Cookie'), /; Secure/);
 const publicCookie = publicLogin.headers.get('Set-Cookie').split(';')[0];
 assert.equal((await mf.dispatchFetch('https://game.invalid/api/rooms', { method: 'POST', headers: { Origin: 'https://game.invalid', 'Content-Type': 'application/json', Cookie: publicCookie, 'CF-Connecting-IP': 'public-test' }, body: '{}' })).status, 400, '公開環境不得使用示範題');
 const name = "正式題庫'); DROP TABLE question_banks; --";
 let bank = await ok('/api/admin/banks', 'POST', { title: name, description: '備註', questions: [] }, cookie, 201);
 const path = '/api/admin/banks/' + bank.id; assert.equal(bank.title, name); assert.equal(bank.revision, 1);
 assert.equal((await call(path, 'GET')).status, 401);
 assert.equal((await call(path + '/publish', 'POST', { revision: 1 }, cookie)).status, 400, '空題庫不可發布');
 assert.equal((await call(path, 'PUT', { revision: 1 }, cookie, { Origin: 'https://evil.invalid' })).status, 403);
 assert.equal((await call(path, 'DELETE', { revision: 1 }, cookie, { Origin: 'https://evil.invalid' })).status, 403);
 assert.equal((await call(path, 'PUT', { revision: 1, title: '超長', description: '', questions: [], padding: 'x'.repeat(263000) }, cookie)).status, 413);
 const questions = [1, 2, 3].map(round => ({ id: 'q-' + round, round, text: '<script>alert("xss")</script>題目' + round, options: ['正確', '錯誤'], correct: 0, seconds: 15, points: 100 }));
 const draft = { title: name, description: '', questions };
 bank = await ok(path, 'PUT', { ...draft, revision: 1 }, cookie); assert.equal(bank.revision, 2);
 assert.equal((await call(path, 'PUT', { ...draft, revision: 1 }, cookie)).status, 409, '舊分頁不可覆蓋新版');
 assert.equal((await call(path + '/publish', 'POST', { revision: 1 }, cookie)).status, 409);
 assert.equal((await call(path, 'PUT', { ...draft, revision: 2, questions: [{ ...questions[0], correct: 9 }] }, cookie)).status, 400);
 assert.equal((await call('/api/rooms', 'POST', { bankId: bank.id, publishedRevision: 2 }, cookie)).status, 409, '未發布不可建立正式房間');
 bank = await ok(path + '/publish', 'POST', { revision: 2 }, cookie); assert.equal(bank.publishedRevision, 3);
 const listing = await ok('/api/admin/banks', 'GET', undefined, cookie); assert.equal(listing.banks[0].publishedCount, 3); assert.equal(listing.banks[0].questions, undefined);
 const room = await ok('/api/rooms', 'POST', { bankId: bank.id, publishedRevision: 3 }, cookie, 201);
 const modified = questions.map(q => ({ ...q, text: '更新後題目', correct: 1 }));
 bank = await ok(path, 'PUT', { ...draft, revision: 3, questions: modified }, cookie); assert.equal(bank.publishedRevision, 3); assert.equal(bank.revision, 4);
 const stored = await db.prepare('SELECT published_questions FROM question_banks WHERE id=?').bind(bank.id).first();
 assert.equal(JSON.parse(stored.published_questions)[0].text, questions[0].text, '改草稿不影響發布內容');
 await ok('/api/rooms', 'POST', { bankId: bank.id, publishedRevision: 3 }, cookie, 201);
 bank = await ok(path + '/publish', 'POST', { revision: 4 }, cookie); assert.equal(bank.publishedRevision, 5);
 assert.equal((await call('/api/rooms', 'POST', { bankId: bank.id, publishedRevision: 3 }, cookie)).status, 409, '舊版本必須重新確認');
 // A saved question bank must survive another Worker/D1 request, and the game's copy must stay immutable.
 assert.equal((await ok(path, 'GET', undefined, cookie)).questions[0].text, '更新後題目');
 const response = await mf.dispatchFetch(base + `/api/rooms/${room.roomId}/socket`, { headers: { Origin: base, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'family.v1, auth.' + room.hostToken } });
 assert.equal(response.status, 101); const ws = response.webSocket; ws.accept(); sockets.push(ws); const messages = [];
 ws.addEventListener('message', e => messages.push(JSON.parse(e.data))); await until(() => messages.some(m => m.type === 'state.snapshot'));
 const snapshot = () => messages.filter(m => m.type === 'state.snapshot').at(-1);
 ws.send(JSON.stringify({ protocol: 1, type: 'host.command', action: 'start', commandId: crypto.randomUUID(), expectedVersion: snapshot().version }));
 await until(() => snapshot().phase === 'QUESTION_OPEN'); assert.equal(snapshot().question.text, questions[0].text); assert.equal(snapshot().question.correct, undefined);
 await ok(path, 'DELETE', { revision: 5 }, cookie); assert.equal((await call(path, 'GET', undefined, cookie)).status, 404);
 assert.equal((await ok('/api/admin/banks', 'GET', undefined, cookie)).banks.length, 0);
 assert.equal((await call('/api/rooms', 'POST', { bankId: bank.id, publishedRevision: 5 }, cookie)).status, 404);
 assert.equal((await db.prepare('SELECT archived_at FROM question_banks WHERE id=?').bind(bank.id).first()).archived_at > 0, true, '封存保留資料');
 ws.send(JSON.stringify({ protocol: 1, type: 'host.command', action: 'close', commandId: crypto.randomUUID(), expectedVersion: snapshot().version }));
 await until(() => snapshot().phase === 'QUESTION_CLOSED');
 ws.send(JSON.stringify({ protocol: 1, type: 'host.command', action: 'reveal', commandId: crypto.randomUUID(), expectedVersion: snapshot().version }));
 await until(() => snapshot().phase === 'REVEAL'); assert.equal(snapshot().question.correct, 0, '既有遊戲使用原發布版答案');
 await ok('/api/admin/logout', 'POST', {}, cookie); assert.equal((await call('/api/admin/session', 'GET', undefined, cookie)).status, 401, '登出撤銷被複製的Cookie');
 const again = await call('/api/admin/login', 'POST', { password: secret }); const expiresCookie = again.headers.get('Set-Cookie').split(';')[0];
 const directory = await mf.unsafeGetDurableObjectStorage('admin-test', 'RoomDirectory', { name: 'directory-v1' });
 await directory.exec('UPDATE admin_sessions SET expires=0');
 assert.equal((await call('/api/admin/session', 'GET', undefined, expiresCookie)).status, 401, '逾時失效');
 const fresh = await call('/api/admin/login', 'POST', { password: secret }); const rotatedCookie = fresh.headers.get('Set-Cookie').split(';')[0];
 const partial = await ok('/api/admin/banks', 'POST', { title: '未填完草稿', description: '', questions: [{ ...questions[0], text: '', options: ['', ''], correct: -1 }] }, rotatedCookie, 201);
 assert.equal(partial.questions[0].correct, -1);
 assert.equal((await call(`/api/admin/banks/${partial.id}/publish`, 'POST', { revision: partial.revision }, rotatedCookie)).status, 400, '草稿可未填完，但不准發布');
 const competing = await Promise.all(['分頁A', '分頁B'].map(title => call(`/api/admin/banks/${partial.id}`, 'PUT', { title, description: '', questions: [questions[0]], revision: 1 }, rotatedCookie)));
 assert.deepEqual(competing.map(r => r.status).sort(), [200, 409], '同步寫入僅一個版本條件可成功');
 assert.equal((await call(`/api/admin/banks/${partial.id}/publish`, 'POST', { revision: 2 }, rotatedCookie)).status, 400, '完整單題仍不可發布，須有三回合');
 const large = Array.from({ length: 60 }, (_, i) => ({ id: 'large-' + i, round: 1 + Math.floor(i / 20), text: '題'.repeat(300), options: ['甲'.repeat(100), '乙'.repeat(100), '丙'.repeat(100), '丁'.repeat(100)], correct: 0, seconds: 120, points: 10000 }));
 const largeBank = await ok('/api/admin/banks', 'POST', { title: '60題中文上限', description: '', questions: large }, rotatedCookie, 201);
 assert.equal(largeBank.questionCount, 60, '合法中文字元上限仍可儲存');
 await directory.exec("UPDATE admin_sessions SET secret_hash='rotated-secret'");
 assert.equal((await call('/api/admin/session', 'GET', undefined, rotatedCookie)).status, 401, '管理密碼更換後舊憑證失效');
 for (let i = 0; i < 5; i++) assert.equal((await call('/api/admin/login', 'POST', { password: 'wrong' }, undefined, { 'CF-Connecting-IP': 'brute-force' })).status, 401);
 assert.equal((await call('/api/admin/login', 'POST', { password: secret }, undefined, { 'CF-Connecting-IP': 'brute-force' })).status, 429, '登入暴力嘗試限流');
 console.log('PASS: D1 migration、管理登入／Secure Cookie／登出撤銷／逾時、來源與權限、SQL參數綁定、草稿CRUD、版本衝突、發布驗證、房間題庫快照、封存、登入限流');
} finally { for (const ws of sockets) { try { ws.close(); } catch {} } await mf.dispose(); }
