import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from './migrations.mjs';
const name='rooms-admin-test', secret='room-admin-test-only-long-secret', base='http://localhost';
const bundle=await build({entryPoints:['apps/worker/src/index.ts'],bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers']});
const mf=new Miniflare({...convertV4MiniflareOptions({name,modules:true,script:bundle.outputFiles[0].text,cf:false,compatibilityDate:'2026-10-01',bindings:{ADMIN_SECRET:secret},
 durableObjects:{ROOMS:{className:'GameRoom',useSQLite:true},DIRECTORY:{className:'RoomDirectory',useSQLite:true}},d1Databases:{DB:'room-test-db'},serviceBindings:{ASSETS:()=>new Response('asset')}}),unsafeInspectDurableObjects:true});
let cookie; const sockets=[];
const call=(path,method='GET',data,headers={})=>mf.dispatchFetch(base+path,{method,headers:{...(method==='GET'?{}:{Origin:base}),...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
async function ok(path,method='GET',data){const r=await call(path,method,data);const result=await r.json();assert.equal(r.ok,true,JSON.stringify(result));return result;}
async function until(fn){const due=Date.now()+3000;while(Date.now()<due){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('room state timeout');}
async function connect(room,token){const r=await call(`/api/rooms/${room}/socket`,'GET',undefined,{Origin:base,Upgrade:'websocket','Sec-WebSocket-Protocol':'family.v1, auth.'+token});assert.equal(r.status,101);const ws=r.webSocket;ws.messages=[];ws.addEventListener('message',e=>ws.messages.push(JSON.parse(e.data)));ws.accept();sockets.push(ws);await until(()=>ws.messages.some(m=>m.type==='state.snapshot'));return ws;}
const snapshot=ws=>ws.messages.filter(m=>m.type==='state.snapshot').at(-1);
async function command(ws,action){const commandId=crypto.randomUUID();ws.send(JSON.stringify({protocol:1,type:'host.command',commandId,expectedVersion:snapshot(ws).version,action}));await until(()=>ws.messages.some(m=>m.type==='command.ack'&&m.commandId===commandId));}
try{
 await applyMigrations(await mf.getD1Database('DB',name));
 for(const path of ['/api/admin/rooms','/api/admin/rooms/ABCDEFG2']){const r=await call(path);assert.equal(r.status,401);assert.equal(r.headers.get('Cache-Control'),'no-store');}
 assert.equal((await mf.listDurableObjectIds('GameRoom',name)).length,0,'未登入不配置物件');
 const login=await call('/api/admin/login','POST',{password:secret});assert.equal(login.status,200);cookie=login.headers.get('Set-Cookie').split(';')[0];
 assert.deepEqual((await ok('/api/admin/rooms')).rooms,[]);
 for(const cursor of ['','bad','9007199254740992.ABCDEFG2','1.ABCDEFG0','-1.ABCDEFG2'])assert.equal((await call('/api/admin/rooms?cursor='+encodeURIComponent(cursor))).status,400);
 assert.equal((await call('/api/admin/rooms/ABCDEFG2')).status,404);
 assert.equal((await call('/api/admin/rooms/bad')).status,404);
 assert.equal((await mf.listDurableObjectIds('GameRoom',name)).length,0,'未知房間不配置物件');
 assert.equal((await call('/api/admin/rooms','POST',{})).status,405);
 assert.equal((await call('/api/admin/rooms','POST',{}, {Origin:'https://evil.invalid'})).status,403);
 const room=await ok('/api/rooms','POST',{}), path='/api/admin/rooms/'+room.roomId;
 const initial=await ok(path);assert.equal(initial.phase,'LOBBY');assert.equal(initial.lifecycle,'open');assert.equal(initial.hostOnline,false);assert.equal(initial.questionCount,3);assert.equal(initial.startedAt,null);
 const host=await connect(room.roomId,room.hostToken);
 const pending=await ok(`/api/rooms/${room.roomId}/join`,'POST',{nickname:'尚未連線'});
 assert.equal((await ok(path)).joined,0,'pending不列為已加入');
 const player=await ok(`/api/rooms/${room.roomId}/join`,'POST',{nickname:'測試玩家'}), ws=await connect(room.roomId,player.playerToken);
 const online=await ok(path);assert.equal(online.online,1);assert.equal(online.joined,1);assert.equal(online.hostOnline,true);
 for(const token of [room.hostToken,player.playerToken])assert.equal((await call(path,'GET',undefined,{Cookie:'',Authorization:'Bearer '+token})).status,401,'房間憑證不授予後台權限');
 const storage=await mf.unsafeGetDurableObjectStorage(name,'GameRoom',{name:room.roomId});
 const stateBefore=await storage.exec("SELECT value FROM meta WHERE key='state'");
 const leasesBefore=await storage.exec('SELECT * FROM limits ORDER BY key');
 await ok('/api/admin/rooms');await ok(path);await ok(path);
 assert.deepEqual(await storage.exec("SELECT value FROM meta WHERE key='state'"),stateBefore,'檢視不推進遊戲');
 assert.deepEqual(await storage.exec('SELECT * FROM limits ORDER BY key'),leasesBefore,'檢視不消耗主持人指令或重連額度');
 await command(host,'start');await until(()=>snapshot(host).phase==='QUESTION_OPEN');
 const started=await ok(path);assert.equal(started.phase,'QUESTION_OPEN');assert.equal(started.round,1);assert.equal(started.questionIndex,0);assert.ok(started.startedAt>0);assert.ok(started.deadline>Date.now());
 for(const key of ['hostToken','host','players','questions','question','answers','correct','hash','self'])assert.equal(started[key],undefined,'狀態API不含'+key);
 assert.equal(host.messages.some(m=>m.type==='session.replaced'),false,'檢視不取代主持人');
 ws.close(1000);await until(async()=>(await ok(path)).online===0);assert.equal((await ok(path)).joined,1);
 await command(host,'end');assert.equal((await ok(path)).lifecycle,'finished');assert.ok((await ok(path)).archive);
 await command(host,'closeRoom');const closed=await ok(path);assert.equal(closed.lifecycle,'closed');assert.equal(closed.hostOnline,false);assert.equal(closed.online,0);
 const directory=await mf.unsafeGetDurableObjectStorage(name,'RoomDirectory',{name:'directory-v1'});
 await storage.exec("UPDATE meta SET value='0' WHERE key='expires'");
 await directory.exec('UPDATE rooms SET expires=0 WHERE id=?',room.roomId);
 assert.equal((await ok(path)).lifecycle,'expired');assert.equal((await ok('/api/admin/rooms')).rooms.length,0,'到期房間離開清單，仍可按代碼查看');
 // Seed eleven known entries with identical expiry to exercise keyset ties;
 // these intentionally uninitialised rooms also test unavailable handling.
 const expires=Date.now()+86400000;
 for(const letter of 'ABCDEFGHIJK'.replace('I','L')){const id='AAAAAAA'+letter;await directory.exec('INSERT INTO rooms VALUES (?,?)',id,expires);await directory.exec('INSERT INTO known_rooms VALUES (?)',id);}
 const first=await ok('/api/admin/rooms');assert.equal(first.rooms.length,10);assert.ok(first.nextCursor);assert.ok(first.rooms.every(r=>r.status===null));
 const second=await ok('/api/admin/rooms?cursor='+encodeURIComponent(first.nextCursor));assert.equal(second.rooms.length,1);assert.equal(second.nextCursor,null);
 assert.equal(new Set([...first.rooms,...second.rooms].map(r=>r.roomId)).size,11,'分頁不重複、不遺漏同到期時間的房間');
 await ok('/api/admin/logout','POST',{});assert.equal((await call(path)).status,401);assert.equal((await call('/api/admin/rooms')).status,401);
 console.log('PASS: 房間登入保護／未知ID不配置、清單分頁、pending與在線人數、主持人不被取代、遊戲階段與歸檔、關閉／到期、狀態不洩漏憑證正解、查詢不改遊戲、登出撤銷');
}finally{for(const ws of sockets){try{ws.close()}catch{}}await mf.dispose();}
