const assert=require('node:assert/strict');const WebSocket=require('ws');
const base=process.env.TEST_URL||'http://127.0.0.1:8787';const key=process.env.TEST_ADMIN_SECRET||'local-test-only-very-long-secret';
async function post(path,data,secret){return fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...(secret?{Authorization:'Bearer '+secret}:{})},body:JSON.stringify(data)});}
function connect(room,token){return new Promise((resolve,reject)=>{const ws=new WebSocket(base.replace('http','ws')+`/api/rooms/${room}/socket`,['family.v1','auth.'+token],{origin:base});ws.messages=[];ws.on('message',b=>{const m=JSON.parse(b);ws.messages.push(m);if(m.type==='session.replaced')ws.terminate();});ws.once('open',()=>resolve(ws));ws.once('error',reject)});}
async function until(fn){const end=Date.now()+5000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('等待同步逾時');}
(async()=>{const sockets=[];try{
 assert.equal((await post('/api/rooms',{})).status,401);
 let r=await post('/api/rooms',{},key);assert.equal(r.status,201);const room=await r.json();
 const host=await connect(room.roomId,room.hostToken);sockets.push(host);
 const p=[];for(let i=0;i<2;i++){r=await post(`/api/rooms/${room.roomId}/join`,{nickname:'玩家'+i});assert.equal(r.status,201);p.push(await r.json());sockets.push(await connect(room.roomId,p[i].playerToken));}
 await until(()=>host.messages.at(-1)?.online===2);assert.equal(host.messages.at(-1).joined,2);
 const dup=await connect(room.roomId,p[0].playerToken);sockets.push(dup);
 await until(()=>sockets[1].readyState===3);await until(()=>host.messages.at(-1)?.online===2);
 sockets[2].send(JSON.stringify({protocol:1,type:'session.leave'}));await until(()=>host.messages.at(-1)?.online===1);assert.equal(host.messages.at(-1).joined,2);
 assert.equal((await post(`/api/rooms/${room.roomId}/join`,{nickname:''})).status,400);
 console.log('PASS: 認證、建立房間、兩玩家同步、同身分取代、離線人數、暱稱驗證');
}finally{for(const s of sockets)s.terminate();}})().catch(e=>{console.error(e);process.exitCode=1});
