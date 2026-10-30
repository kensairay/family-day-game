import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {withServer, HOST_KEY} from './server.js';
import {QUESTIONS} from '../src/questions.js';

await withServer(async (url, {restart}) => {
  const prefix=url+'/api/rooms/family-day/';
  async function api(path, body, token='') {
    const r=await fetch(prefix+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,body:await r.json()};
  }
  function connect(role,token='') {
    return new Promise((resolve,reject)=> {
      const ws=new WebSocket(prefix.replace('http:','ws:')+'ws');let lastState;
      const timeout=setTimeout(()=>reject(new Error('WebSocket authentication timed out')),10000);
      ws.addEventListener('open',()=>ws.send(JSON.stringify({type:'auth',role,token})));
      ws.addEventListener('error',reject,{once:true});
      ws.addEventListener('message',message=> {
        if(message.data==='pong')return;
        lastState=JSON.parse(message.data).state;
        if(lastState){clearTimeout(timeout);resolve({ws,get state(){return lastState;}});}
      });
    });
  }
  async function until(fn) {for(let i=0;i<120;i++){if(fn())return;await delay(100);}throw new Error('Expected state did not arrive');}
  assert.equal((await api('state?role=host')).status,401);
  assert.equal((await api('state?role=player','',crypto.randomUUID())).status,401);
  const cross=await fetch(prefix+'join',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'});assert.equal(cross.status,403);
  const tokens=Array.from({length:350},()=>crypto.randomUUID());
  const start=Date.now();
  // Bounded batches still exercise overlapping requests and duplicate nickname joins.
  for(let i=0;i<tokens.length;i+=25) {
    const results=await Promise.all(tokens.slice(i,i+25).map(token=>api('join',{token,nickname:'小明'})));
    assert.ok(results.every(r=>r.status===200));
  }
  assert.equal((await api('join',{token:crypto.randomUUID(),nickname:'超額'})).status,409);
  const restored=await api('join',{token:tokens[0],nickname:'不該改名'});assert.equal(restored.body.me.name,'小明');
  const host=await connect('host',HOST_KEY), screen=await connect('screen');
  const clients=[];
  for(let i=0;i<tokens.length;i+=25) clients.push(...await Promise.all(tokens.slice(i,i+25).map(token=>connect('player',token))));
  assert.equal(new Set(clients.map(c=>c.state.me.name)).size,350);
  const act=async action=> {
    const s=(await api('state?role=host',null,HOST_KEY)).body;
    const cmd={action,revision:s.revision,commandId:crypto.randomUUID()};
    const result=await api('host',cmd,HOST_KEY);assert.equal(result.status,200);
    return {cmd,result};
  };
  await act('start');
  await until(()=>clients.every(c=>c.state.phase==='open') && screen.state.phase==='open');
  assert.ok(!JSON.stringify(screen.state).includes('correct'));
  assert.ok(!JSON.stringify(screen.state).includes(tokens[0]));
  const submissions=await Promise.all(tokens.map(token=>api('answer',{questionId:'r1q1',choice:2},token)));
  assert.ok(submissions.every(r=>r.status===200 && r.body.me.answer.choice===2 && r.body.me.score===0));
  await until(()=>host.state.answeredCount===350);
  const {cmd}=await act('reveal');
  const duplicate=await api('host',cmd,HOST_KEY);assert.equal(duplicate.status,200);
  await until(()=>clients.every(c=>c.state.me.score===260 && c.state.phase==='revealed'));
  assert.equal((await api('answer',{questionId:'r1q1',choice:0},tokens[0])).body.me.answer.choice,2);
  assert.equal(clients[0].state.leaderboard.length,0);assert.equal(host.state.leaderboard.filter(p=>p.rank===1 && p.tied).length,350);
  clients[0].ws.close();const reconnected=await connect('player',tokens[0]);assert.equal(reconnected.state.me.score,260);
  await act('next');assert.equal((await api('answer',{questionId:'r1q1',choice:0},tokens[0])).status,409);
  for(const q of QUESTIONS.slice(1)) {
    await api('answer',{questionId:q.id,choice:q.correct},tokens[0]);await act('reveal');await act('next');
  }
  const final=(await api('state?role=player',null,tokens[0])).body;
  assert.equal(final.phase,'finished');assert.equal(final.me.score,2340);
  assert.equal(final.leaderboard[0].rank,1);
  const hostState=(await api('state?role=host',null,HOST_KEY)).body;
  assert.equal(hostState.leaderboard[0].score,2340);
  // Alarm-driven D1 archive must eventually drain; export also includes durable pending entries.
  await untilAsync(async()=> (await api('state?role=host',null,HOST_KEY)).body.archive.pending===0);
  const exported=await api('export',null,HOST_KEY);assert.equal(exported.status,200);
  assert.equal(exported.body.players.length,350);assert.equal(exported.body.events.filter(e=>e.kind==='answered').length,358);
  assert.ok(!JSON.stringify(exported.body).includes(tokens[0]));
  for(const client of [host,screen,...clients,reconnected])client.ws.close();
  await restart();
  const recovered=(await api('state?role=player',null,tokens[0])).body;
  assert.equal(recovered.phase,'finished');assert.equal(recovered.me.score,2340);
  assert.equal((await api('state?role=host',null,HOST_KEY)).body.playerCount,350);
  assert.equal((await api('export',null,HOST_KEY)).body.events.length,exported.body.events.length);
  console.log(`PASS: local Workers/DO/D1, 350 joined players and WebSocket connections, burst answers, no early answer leakage, retries, reconnect, 3 rounds, final rank, archive/export, process restart recovery (${((Date.now()-start)/1000).toFixed(1)}s)`);
});
async function untilAsync(fn){for(let i=0;i<120;i++){if(await fn())return;await delay(250);}throw new Error('Archive did not drain');}
