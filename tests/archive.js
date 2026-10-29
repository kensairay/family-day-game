import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {withServer,HOST_KEY} from './server.js';
await withServer(async(url,{restoreArchive})=> {
  const prefix=url+'/api/rooms/family-day/';
  const token=crypto.randomUUID();
  async function api(path,body,key=HOST_KEY) {
    const response=await fetch(prefix+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${key}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  }
  assert.equal((await api('join',{nickname:'封存恢復測試',token})).status,200);
  for(const action of ['start']) {
    const s=(await api('state?role=host')).body;
    assert.equal((await api('host',{action,revision:s.revision,commandId:crypto.randomUUID()})).status,200);
  }
  assert.equal((await api('answer',{questionId:'r1q1',choice:2},token)).status,200);
  let s=(await api('state?role=host')).body;
  assert.equal((await api('host',{action:'reveal',revision:s.revision,commandId:crypto.randomUUID()})).status,200);
  for(let i=0;i<80;i++) {
    s=(await api('state?role=host')).body;
    if(s.archive.error)break;
    await delay(100);
  }
  assert.ok(s.archive.error);assert.equal(s.archive.pending,4);
  assert.equal((await api('state?role=player',null,token)).body.me.score,260);
  assert.equal((await api('export')).status,503);
  await restoreArchive();
  for(let i=0;i<80;i++) {
    s=(await api('state?role=host')).body;
    if(s.archive.pending===0)break;
    await delay(100);
  }
  assert.equal(s.archive.pending,0);assert.equal(s.archive.error,false);
  const exported=(await api('export')).body;
  assert.equal(exported.events.length,4);assert.equal(exported.players[0].score,260);
  console.log('PASS: unavailable D1 does not lose receipt/score; durable outbox survives restart and archives once after D1 recovery');
},{archiveReady:false});
