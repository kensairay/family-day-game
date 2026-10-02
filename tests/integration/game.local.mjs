import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const bundle = await build({ entryPoints: ['apps/worker/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
const mf = new Miniflare({ ...convertV4MiniflareOptions({
  name: 'family-test', modules: true, script: bundle.outputFiles[0].text, cf: false, compatibilityDate: '2026-10-01',
  bindings: { ADMIN_SECRET: 'local-test-only-very-long-secret' },
  durableObjects: { ROOMS: { className: 'GameRoom', useSQLite: true }, DIRECTORY: { className: 'RoomDirectory', useSQLite: true } },
  serviceBindings: { ASSETS: () => new Response('test asset') },
}), unsafeInspectDurableObjects: true });
const base = 'http://localhost';
const sockets = [];
const post = (path, data, secret) => mf.dispatchFetch(base + path, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...(secret ? { Authorization: 'Bearer ' + secret } : {}) }, body: JSON.stringify(data) });
async function until(predicate, label = '等待同步', timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)); }
  throw new Error(label + '逾時');
}
async function connect(room, token) {
  const response = await mf.dispatchFetch(base + `/api/rooms/${room}/socket`, { headers: { Origin: base, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'family.v1, auth.' + token } });
  if (response.status !== 101) assert.fail('socket upgrade: ' + response.status + ' ' + await response.text());
  const ws = response.webSocket; ws.accept(); ws.messages = [];
  ws.addEventListener('message', event => { const msg = JSON.parse(event.data); ws.messages.push(msg); if (msg.type === 'session.replaced') ws.close(); });
  sockets.push(ws); await until(() => ws.messages.some(m => m.type === 'state.snapshot'), '初始快照'); return ws;
}
const state = ws => ws.messages.filter(m => m.type === 'state.snapshot').at(-1);
const send = (ws, data) => ws.send(JSON.stringify({ protocol: 1, ...data }));
async function expectError(ws, data, status) {
  const before = ws.messages.length; send(ws, data);
  await until(() => ws.messages.slice(before).some(m => m.type === 'error' && m.status === status), '錯誤回應 ' + status);
}
async function command(host, action, extra = {}) {
  const msg = { type: 'host.command', commandId: crypto.randomUUID(), expectedVersion: state(host).version, action, ...extra };
  send(host, msg); await until(() => host.messages.some(m => m.type === 'command.ack' && m.commandId === msg.commandId), action);
  await until(() => state(host).version > msg.expectedVersion, '狀態推進'); return msg;
}
try {
  assert.equal((await mf.dispatchFetch('https://example.invalid/api/config')).status, 503, '公開部署未設定不得開放API');
  assert.equal((await post('/api/rooms', {})).status, 401);
  assert.equal((await mf.dispatchFetch(base + '/api/rooms', { method: 'POST', headers: { Origin: 'https://evil.invalid', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await post('/api/rooms/ABCDEFG2/join', { nickname: '測試' })).status, 404);
  assert.equal((await mf.listDurableObjectIds('GameRoom', 'family-test')).length, 0, '不存在的房間不得分配遊戲物件');
  const asset = await mf.dispatchFetch(base + '/'); assert.ok(asset.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));
  const q = [
    { id: 'test-1', round: 1, text: '第一題', options: ['錯誤', '正確'], correct: 1, seconds: 3, points: 260 },
    { id: 'test-2', round: 2, text: '第二題', options: ['正確', '錯誤'], correct: 0, seconds: 3, points: 260 },
    { id: 'test-3', round: 3, text: '第三題', options: ['錯誤', '正確'], correct: 1, seconds: 3, points: 260 },
  ];
  const created = await post('/api/rooms', { questions: q }, 'local-test-only-very-long-secret'); assert.equal(created.status, 201);
  const room = await created.json(); const host = await connect(room.roomId, room.hostToken);
  const pending = await post(`/api/rooms/${room.roomId}/join`, { nickname: '未連線' }); assert.equal(pending.status, 201);
  const pendingPlayer = await pending.json(); assert.equal(state(host).joined, 0);
  // Fast-forward only the test runtime's storage to verify pending reservations are reclaimed.
  const storage = await mf.unsafeGetDurableObjectStorage('family-test', 'GameRoom', { name: room.roomId });
  await storage.exec('UPDATE players SET pendingUntil=0 WHERE id=?', pendingPlayer.playerId);
  const players = [];
  for (let i = 0; i < 3; i++) {
    const response = await post(`/api/rooms/${room.roomId}/join`, { nickname: i === 0 ? '<script>' : '玩家' + i }); assert.equal(response.status, 201);
    const p = await response.json(); players.push({ ...p, ws: await connect(room.roomId, p.playerToken) });
  }
  await until(() => state(host).online === 3 && state(host).joined === 3, '真實人數');
  assert.equal((await storage.exec('SELECT id FROM players WHERE id=?', pendingPlayer.playerId)).length, 0);
  const oversized = await mf.dispatchFetch(base + `/api/rooms/${room.roomId}/join`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'a'.repeat(5000) }) });
  assert.equal(oversized.status, 413);
  // Remove one player, revoke its credentials, then confirm another player can join.
  await command(host, 'removePlayer', { playerId: players[2].playerId });
  const revoked = await mf.dispatchFetch(base + `/api/rooms/${room.roomId}/socket`, { headers: { Origin: base, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'family.v1, auth.' + players[2].playerToken } }); assert.equal(revoked.status, 401);
  await expectError(players[0].ws, { type: 'host.command', action: 'start', commandId: crypto.randomUUID(), expectedVersion: state(host).version }, 403);
  await command(host, 'start');
  await until(() => state(players[0].ws).phase === 'QUESTION_OPEN');
  assert.equal(state(players[0].ws).question.correct, undefined);
  assert.equal((await post(`/api/rooms/${room.roomId}/join`, { nickname: '遲到玩家' })).status, 409);
  await expectError(host, { type: 'host.command', action: 'reveal', commandId: crypto.randomUUID(), expectedVersion: 0 }, 409);
  const answer = { type: 'answer.submit', requestId: crypto.randomUUID(), questionId: 'test-1', option: 1, score: 999999 };
  send(players[0].ws, answer); await until(() => players[0].ws.messages.some(m => m.type === 'answer.ack'));
  assert.equal(players[0].ws.messages.find(m => m.type === 'answer.ack').earned, undefined);
  send(players[0].ws, answer); await until(() => players[0].ws.messages.filter(m => m.type === 'answer.ack').length === 2);
  await expectError(players[0].ws, { ...answer, requestId: crypto.randomUUID(), option: 0 }, 409);
  send(players[1].ws, { ...answer, requestId: crypto.randomUUID() }); await until(() => players[1].ws.messages.some(m => m.type === 'answer.ack'));
  send(players[0].ws, { type: 'state.sync' }); await until(() => state(players[0].ws).self.answer === 1);
  assert.equal(state(players[0].ws).self.score, 0); assert.equal(state(players[0].ws).self.earned, undefined);
  await until(() => state(host).phase === 'QUESTION_CLOSED', '自動收題', 7000);
  await expectError(players[0].ws, { ...answer, requestId: crypto.randomUUID() }, 409);
  const reveal = await command(host, 'reveal');
  await until(() => state(players[0].ws).self.score === 260);
  assert.equal(state(players[0].ws).question.correct, 1); assert.deepEqual(state(host).leaderboard.map(p => p.rank), [1, 1]);
  send(host, reveal); await new Promise(r => setTimeout(r, 30)); assert.equal(state(host).version, reveal.expectedVersion + 1);
  // Evict/recreate the live room while retaining WebSockets, and check persisted scores and state.
  const beforeEvict = players[0].ws.messages.length;
  await mf.unsafeEvictDurableObject('family-test', 'GameRoom', { name: room.roomId, webSockets: 'hibernate' });
  send(players[0].ws, { type: 'state.sync' });
  await until(() => players[0].ws.messages.slice(beforeEvict).some(m => m.type === 'state.snapshot' && m.phase === 'REVEAL' && m.self.score === 260), '重建恢復');
  await command(host, 'next'); assert.equal(state(host).phase, 'ROUND_END');
  await command(host, 'start'); await command(host, 'close'); await command(host, 'reveal'); await command(host, 'next');
  await command(host, 'start'); await command(host, 'close'); await command(host, 'reveal'); await command(host, 'next');
  assert.equal(state(host).phase, 'FINISHED');
  assert.equal((await storage.exec('SELECT COUNT(*) AS n FROM answers WHERE player=?', players[0].playerId))[0].n, 1);
  // Message flood is cut off before exhausting the room; another client remains healthy.
  for (let i = 0; i < 8; i++) send(players[1].ws, { type: 'state.sync' });
  await until(() => players[1].ws.messages.some(m => m.type === 'error' && m.status === 429), 'WebSocket限流');
  await command(host, 'closeRoom');
  const closed = await post(`/api/rooms/${room.roomId}/join`, { nickname: '關閉後' }); assert.equal(closed.status, 410);
  // Same-IP rapid registration stops at 30 requests/minute, not 350 durable accounts.
  let blocked = false;
  for (let i = 0; i < 35; i++) { const response = await post('/api/rooms/ABCDEFG2/join', { nickname: '佔位' }); if (response.status === 429) { blocked = true; break; } }
  assert.ok(blocked);
  console.log('PASS: 來源驗證、不存在房間不配置物件、名額回收／撤銷、權限、三回合、截止、正解保密、冪等答案／指令、重建復原、排行榜、限流、房間關閉');
} finally { for (const ws of sockets) { try { ws.close(); } catch {} } await mf.dispose(); }
