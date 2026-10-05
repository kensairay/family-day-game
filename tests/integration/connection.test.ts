import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const built = await build({ entryPoints: ['apps/web/src/lib/connection.ts'], bundle: true, write: false, format: 'esm' });
const { RoomConnection } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

function setup(t: any, statusCode = 200) {
 const sockets: any[] = [], statuses: any[] = [], received: any[] = [];
 class FakeSocket {
  static OPEN = 1;
  readyState = 0; onopen?: () => void; onmessage?: (event: any) => void; onclose?: (event: any) => void;
  constructor(_url: URL, _protocols: string[]) { sockets.push(this); }
  send() {}
  close() { this.readyState = 3; void this.onclose?.({ code: 1000 }); }
 }
 const originals = new Map(['WebSocket','location','fetch'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis,k)]));
 Object.assign(globalThis, { WebSocket: FakeSocket, location: { href: 'https://game.example/?host', protocol: 'https:' }, fetch: async (_url: string, options: any) => {
  assert.equal(options.method, 'POST'); assert.equal(options.headers.Authorization, 'Bearer test-credential');
  return { status: statusCode, ok: statusCode === 200 };
 } });
 t.mock.timers.enable({ apis: ['setTimeout','setInterval','Date'], now: 100_000 });
 const connection = new RoomConnection('ABCDEFGH', 'test-credential', (m: any) => received.push(m), (online: boolean, text: string) => statuses.push({online,text}));
 t.after(() => { connection.stop(); for (const [k, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis,k,descriptor); else Reflect.deleteProperty(globalThis,k); } });
 return { connection, sockets, statuses, received };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

test('握手一直失敗只重試五次，即使已超過一分鐘也不重設預算', async t => {
 const { connection, sockets, statuses } = setup(t); connection.open();
 for (let i=0; i<6; i++) { assert.equal(sockets.length,i+1); sockets[i].close(); await flush(); t.mock.timers.tick(35_000); await flush(); }
 assert.equal(sockets.length,6);
 assert.match(statuses.at(-1).text,/房間與身分有效，但即時連線未成功/);
 assert.equal(statuses.some(s=>s.online),false);
});
test('等到初始快照才開放控制，沒有快照十秒後重新連線', async t => {
 const { connection, sockets, statuses, received } = setup(t); connection.open();
 sockets[0].readyState=1; sockets[0].onopen();
 assert.equal(statuses.at(-1).online,false);
 t.mock.timers.tick(10_001); await flush(); t.mock.timers.tick(3_000); await flush();
 assert.equal(sockets.length,2);
 sockets[1].readyState=1; sockets[1].onopen();
 sockets[1].onmessage({data:'null'}); sockets[1].onmessage({data:'{"type":123}'});
 sockets[1].onmessage({data:'{"type":"state.snapshot","phase":"LOBBY"}'});
 assert.equal(statuses.at(-1).online,true); assert.equal(received.length,1);
 t.mock.timers.tick(10_001); assert.equal(sockets.length,2);
});
test('HTTPS確認房間已到期就停止重試，並顯示原因', async t => {
 const { connection, sockets, statuses } = setup(t,410); connection.open(); sockets[0].close(); await flush();
 assert.match(statuses.at(-1).text,/房間已關閉或到期/);
 t.mock.timers.tick(300_000); assert.equal(sockets.length,1);
});
