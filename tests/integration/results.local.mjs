import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { writeArchiveChunk } from '../../apps/worker/src/results/writer.ts';

const secret = 'results-local-test-only-long-secret';
const bundle = await build({ entryPoints: ['apps/worker/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
const mf = new Miniflare({ ...convertV4MiniflareOptions({
 name: 'results-test', modules: true, script: bundle.outputFiles[0].text, cf: false, compatibilityDate: '2026-10-01',
 bindings: { ADMIN_SECRET: secret }, d1Databases: { DB: 'results-test-db' },
 durableObjects: { ROOMS: { className: 'GameRoom', useSQLite: true }, DIRECTORY: { className: 'RoomDirectory', useSQLite: true } },
 serviceBindings: { ASSETS: () => new Response('test asset') },
}), unsafeInspectDurableObjects: true });
const base = 'http://localhost'; const sockets = []; let cookie;
const call = (path, method = 'GET', data, auth = cookie, extra = {}) => mf.dispatchFetch(base + path, {
 method, headers: { ...(method === 'GET' ? {} : { Origin: base }), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(auth ? { Cookie: auth } : {}), ...extra },
 ...(data === undefined ? {} : { body: JSON.stringify(data) }),
});
async function ok(path, method, data, expected = 200, extra) {
 const response = await call(path, method, data, cookie, extra); const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
}
async function until(predicate, label = '等待', ms = 5000) {
 const end = Date.now() + ms; while (Date.now() < end) { if (await predicate()) return; await new Promise(r => setTimeout(r, 25)); } throw new Error(label + '逾時');
}
const state = ws => ws.messages.filter(m => m.type === 'state.snapshot').at(-1);
async function connect(room, token) {
 const response = await mf.dispatchFetch(base + `/api/rooms/${room}/socket`, { headers: { Origin: base, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'family.v1, auth.' + token } });
 assert.equal(response.status, 101); const ws = response.webSocket; ws.accept(); ws.messages = []; sockets.push(ws);
 ws.addEventListener('message', e => ws.messages.push(JSON.parse(e.data))); await until(() => state(ws)); return ws;
}
async function command(ws, action) {
 const id = crypto.randomUUID(); const version = state(ws).version;
 ws.send(JSON.stringify({ protocol: 1, type: 'host.command', action, commandId: id, expectedVersion: version }));
 await until(() => ws.messages.some(m => m.type === 'command.ack' && m.commandId === id), action);
 await until(() => state(ws).version > version); return id;
}
async function answer(ws, option) {
 const id = crypto.randomUUID(); ws.send(JSON.stringify({ protocol: 1, type: 'answer.submit', requestId: id, questionId: state(ws).question.id, option }));
 await until(() => ws.messages.some(m => m.type === 'answer.ack' && m.requestId === id));
}
const storage = room => mf.unsafeGetDurableObjectStorage('results-test', 'GameRoom', { name: room });
const job = async s => { const row = (await s.exec("SELECT value FROM meta WHERE key='archive'"))[0]; return row ? JSON.parse(row.value) : undefined; };
async function migrate(db, name) {
 const sql = await readFile('migrations/' + name, 'utf8'); await db.batch(sql.split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
}
try {
 const db = await mf.getD1Database('DB', 'results-test'); await migrate(db, '0001_question_banks.sql');
 assert.equal((await call('/api/admin/results', 'GET', undefined, null)).status, 401);
 const login = await call('/api/admin/login', 'POST', { password: secret }, null); cookie = login.headers.get('Set-Cookie').split(';')[0];
 for (const [action, method] of [['status', 'GET'], ['retry', 'POST']]) {
  assert.equal((await call(`/api/admin/results/rooms/ABCDEFG2/${action}`, method, method === 'POST' ? {} : undefined)).status, 404);
 }
 assert.equal((await mf.listDurableObjectIds('GameRoom', 'results-test')).length, 0, '後台查詢／重試未知房間不得配置GameRoom');
 const directory = await mf.unsafeGetDurableObjectStorage('results-test', 'RoomDirectory', { name: 'directory-v1' });
 await directory.exec("INSERT INTO known_rooms VALUES ('OLDAB234')");
 await directory.exec("INSERT INTO rooms VALUES ('OLDAB234',0)");
 await ok('/api/admin/session');
 assert.equal((await directory.exec("SELECT id FROM rooms WHERE id='OLDAB234'")).length, 0);
 assert.equal((await directory.exec("SELECT id FROM known_rooms WHERE id='OLDAB234'")).length, 1, '公開目錄到期清理不移除後台歸檔登記');
 const questions = [1, 2, 3].map(round => ({ id: 'result-' + round, round, text: '第' + round + '題', options: ['正確', '錯誤'], correct: 0, seconds: 15, points: round * 10 }));
 let bank = await ok('/api/admin/banks', 'POST', { title: '=1+1', description: '', questions }, 201);
 bank = await ok(`/api/admin/banks/${bank.id}/publish`, 'POST', { revision: bank.revision });
 const room = await ok('/api/rooms', 'POST', { bankId: bank.id, publishedRevision: bank.publishedRevision }, 201);
 const host = await connect(room.roomId, room.hostToken); const people = [];
 for (const nickname of ['=1+1', '同分玩家', '未答玩家']) {
  const p = await ok(`/api/rooms/${room.roomId}/join`, 'POST', { nickname }, 201); p.ws = await connect(room.roomId, p.playerToken); people.push(p);
 }
 await until(() => state(host).joined === 3); await command(host, 'start');
 for (let round = 1; round <= 3; round++) {
  await until(() => state(people[0].ws).question?.round === round);
  await answer(people[0].ws, 0); await answer(people[1].ws, 0); await command(host, 'close'); await command(host, 'reveal'); await command(host, 'next');
  if (round < 3) await command(host, 'start');
 }
 assert.equal(state(host).phase, 'FINISHED'); const local = await storage(room.roomId);
 await until(async () => (await job(local))?.attempts >= 1, 'D1缺表失敗仍保留任務');
 const queued = await job(local); assert.equal(queued.status, 'pending'); assert.equal(queued.cursor, 0);
 assert.equal(state(people[0].ws).archive, undefined, '玩家不取得後台歸檔入口／狀態');
 assert.equal((await call(`/api/admin/results/rooms/${room.roomId}/retry`, 'POST', {}, cookie, { Origin: 'https://evil.invalid' })).status, 403);
 await command(host, 'closeRoom'); assert.equal((await job(local)).id, queued.id, '關閉房間不建立第二份成績');
 await mf.unsafeEvictDurableObject('results-test', 'GameRoom', { name: room.roomId, webSockets: 'close' });
 assert.equal((await ok(`/api/admin/results/rooms/${room.roomId}/status`)).archive.status, 'pending');
 await migrate(db, '0002_game_results.sql');
 // Let the actual 30-second backoff alarm recover a closed, evicted room without any manual retry request.
 console.log('等待實際自動重試（約30秒；不需主持人在線）…');
 await until(async () => (await job(local))?.status === 'complete', '关闭後自動歸檔', 35000);
 const complete = await job(local); assert.equal(complete.id, queued.id); assert.equal(complete.finalVersion, queued.finalVersion);
 const result = await ok('/api/admin/results/' + queued.id);
 const responseHeaders = await call('/api/admin/results/' + queued.id);
 assert.equal(responseHeaders.headers.get('Cache-Control'), 'no-store');
 assert.equal(responseHeaders.headers.get('X-Content-Type-Options'), 'nosniff');
 assert.equal(result.game.reason, 'completed'); assert.equal(result.game.bankId, bank.id); assert.equal(result.game.bankRevision, bank.publishedRevision); assert.equal(result.game.title, '=1+1');
 assert.deepEqual(result.players.map(p => p.score), [60, 60, 0]); assert.deepEqual(result.players.map(p => p.rank), [1, 1, 3]);
 assert.equal(result.players[0].round1, 10); assert.equal(result.players[0].round2, 20); assert.equal(result.players[0].round3, 30);
 const record = await ok(`/api/admin/results/${queued.id}/players/${people[0].playerId}`); assert.equal(record.answers.length, 3); assert.equal(record.questions[2].correct, 0);
 const sensitive = JSON.stringify(result) + JSON.stringify(record); for (const p of people) assert.equal(sensitive.includes(p.playerToken), false);
 assert.equal(sensitive.includes('requestId'), false); assert.equal(sensitive.includes('hostToken'), false); assert.equal(sensitive.includes('hash'), false);
 assert.equal((await call(`/api/admin/results/${queued.id}/csv`, 'GET', undefined, null)).status, 401);
 const csv = await call(`/api/admin/results/${queued.id}/csv`); assert.match(csv.headers.get('Content-Type'), /text\/csv/); assert.equal(csv.headers.get('Cache-Control'), 'no-store'); assert.ok((await csv.text()).includes('"\'=1+1"'));
 await ok(`/api/admin/results/rooms/${room.roomId}/retry`, 'POST', {});
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM archived_games').first()).n, 1);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM archived_players').first()).n, 3);
 // Closing an open question must retain the received answer, but not silently count unrevealed points.
 const interrupted = await ok('/api/rooms', 'POST', { questions }, 201, { 'CF-Connecting-IP': 'interrupted' }); const ih = await connect(interrupted.roomId, interrupted.hostToken);
 const ip = await ok(`/api/rooms/${interrupted.roomId}/join`, 'POST', { nickname: '中斷玩家' }, 201); const iw = await connect(interrupted.roomId, ip.playerToken);
 await command(ih, 'start'); await until(() => state(iw).phase === 'QUESTION_OPEN'); await answer(iw, 0); await command(ih, 'closeRoom');
 const interruptedStorage = await storage(interrupted.roomId); await until(async () => (await job(interruptedStorage))?.status === 'complete');
 const interruptedId = (await job(interruptedStorage)).id; const incomplete = await ok('/api/admin/results/' + interruptedId);
 assert.equal(incomplete.game.reason, 'closed'); assert.equal(incomplete.players[0].score, 0); assert.equal(incomplete.game.scoredQuestionCount, 0);
 assert.equal((await ok(`/api/admin/results/${interruptedId}/players/${ip.playerId}`)).answers[0].counted, false);
 const ended = await ok('/api/rooms', 'POST', { questions }, 201, { 'CF-Connecting-IP': 'early-end' }); const eh = await connect(ended.roomId, ended.hostToken);
 const ep = await ok(`/api/rooms/${ended.roomId}/join`, 'POST', { nickname: '提前結束玩家' }, 201); const ew = await connect(ended.roomId, ep.playerToken);
 await command(eh, 'start'); await until(() => state(ew).phase === 'QUESTION_OPEN'); await answer(ew, 0); await command(eh, 'end');
 const es = await storage(ended.roomId); await until(async () => (await job(es))?.status === 'complete');
 const early = await ok('/api/admin/results/' + (await job(es)).id); assert.equal(early.game.reason, 'ended'); assert.equal(early.players[0].score, 10);
 // A short-lived internal fixture exercises actual expiry alarms and empty-room archival.
 const roomNamespace = await mf.getDurableObjectNamespace('ROOMS', 'results-test');
 const expiring = roomNamespace.get(roomNamespace.idFromName('EXPRAB23'));
 assert.equal((await expiring.fetch('https://room/init', { method: 'POST', body: JSON.stringify({ id: 'EXPRAB23', hostHash: 'test-only-expiry', expires: Date.now() + 250, questions }) })).status, 200);
 const xs = await storage('EXPRAB23'); await until(async () => (await job(xs))?.status === 'complete', '實際到期自動歸檔');
 const expired = await ok('/api/admin/results/' + (await job(xs)).id); assert.equal(expired.game.reason, 'expired'); assert.equal(expired.players.length, 0);
 // 350 players x 60 answers is a data-volume fixture, not a concurrent-connection load test.
 const largeQuestions = Array.from({ length: 60 }, (_, i) => ({ ...questions[0], id: 'large-' + i, round: 1 + Math.floor(i / 20), points: 1 }));
 const largeRoom = await ok('/api/rooms', 'POST', { questions: largeQuestions }, 201, { 'CF-Connecting-IP': 'large-fixture' }); const lh = await connect(largeRoom.roomId, largeRoom.hostToken); const ls = await storage(largeRoom.roomId);
 await ls.exec(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<349)
  INSERT INTO players(id,nickname,hash,activated,pendingUntil) SELECT 'fixture-'||printf('%04d',i),'測試'||i,'fixture-hash-'||i,1,0 FROM n`);
 await ls.exec(`INSERT INTO answers(player,questionIndex,option,earned,requestId,received)
  SELECT p.id,CAST(j.key AS INTEGER),0,1,'answer-'||j.key,? FROM players p CROSS JOIN json_each((SELECT value FROM meta WHERE key='questions')) j`, Date.now());
 const finalState = { phase: 'REVEAL', index: 59, revealedThrough: 59, deadline: null, version: 1 };
 await ls.exec("UPDATE meta SET value=? WHERE key='state'", JSON.stringify(finalState));
 lh.send(JSON.stringify({ protocol: 1, type: 'state.sync' })); await until(() => state(lh).version === 1);
 await db.prepare(`CREATE TRIGGER fail_second_chunk BEFORE INSERT ON archived_players WHEN NEW.player_id='fixture-0020' BEGIN SELECT RAISE(ABORT,'test-failure'); END`).run();
 await command(lh, 'next'); await until(async () => (await job(ls))?.attempts === 1, '部分成功後故障'); const largeJob = await job(ls);
 assert.equal(largeJob.cursor, 20); assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM archived_players WHERE game_id=?').bind(largeJob.id).first()).n, 20);
 assert.equal((await call('/api/admin/results/' + largeJob.id)).status, 409); assert.equal((await call(`/api/admin/results/${largeJob.id}/csv`)).status, 409);
 await mf.unsafeEvictDurableObject('results-test', 'GameRoom', { name: largeRoom.roomId, webSockets: 'hibernate' });
 await db.prepare('DROP TRIGGER fail_second_chunk').run(); const retry = await ok(`/api/admin/results/rooms/${largeRoom.roomId}/retry`, 'POST', {});
 assert.equal(retry.archive.cursor, 120, '每次最多5批，從持久進度續寫而非全部重跑');
 await until(async () => (await job(ls))?.status === 'complete', '350人續傳完成', 7000);
 const largeResult = await ok('/api/admin/results/' + largeJob.id); assert.equal(largeResult.players.length, 350);
 assert.ok(largeResult.players.every(p => p.score === 60 && p.round1 === 20 && p.round2 === 20 && p.round3 === 20 && p.rank === 1));
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM archived_players WHERE game_id=?').bind(largeJob.id).first()).n, 350);
 assert.equal((await ok(`/api/admin/results/${largeJob.id}/players/fixture-0000`)).answers.length, 60);
 // The database may commit before an acknowledgement is lost: the same chunk must be safe to replay.
 const header = { id: crypto.randomUUID(), roomId: 'ABCDEFG2', source: { bankId: null, revision: null, title: '未知提交結果測試' }, createdAt: Date.now(), startedAt: null,
  endedAt: Date.now(), finalVersion: 1, reason: 'closed', scoredQuestionCount: 0, playerCount: 1, questions };
 const p = { playerId: 'replay-player', nickname: '重試', rank: 1, score: 0, round1: 0, round2: 0, round3: 0, answered: 0, answers: [] };
 const unknownCommit = { prepare: sql => db.prepare(sql), batch: async statements => { await db.batch(statements); throw new Error('lost acknowledgement'); } };
 await assert.rejects(writeArchiveChunk(unknownCommit, header, [p], true)); assert.equal(await writeArchiveChunk(db, header, [p], true), true);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM archived_players WHERE game_id=?').bind(header.id).first()).n, 1);
 console.log('PASS: 真實alarm失敗重試、關閉／休眠後續傳、結算與回合分數、同分排名、題庫快照、權限／CSV公式防護、350人×60題分批與部分失敗、完整性閘門、提交ACK遺失冪等');
} finally { for (const ws of sockets) { try { ws.close(); } catch {} } await mf.dispose(); }
