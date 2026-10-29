import assert from 'node:assert/strict';
import {withServer,HOST_KEY} from './server.js';
const bank=[1,1,2,3].map((round,i)=>({round,roundName:`回合${round}`,text:`正式題目${i+1}`,options:['甲','乙','丙','丁'],correct:1}));
await withServer(async(url,{restart})=>{
 const prefix=url+'/api/rooms/family-day/';
 async function api(path,body,key=HOST_KEY){const r=await fetch(prefix+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${key}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};}
 async function act(action,extra={}){const s=(await api('state?role=host')).body;const cmd={action,revision:s.revision,commandId:crypto.randomUUID(),...extra};const r=await api('host',cmd);assert.equal(r.status,200,JSON.stringify(r.body));return{cmd,result:r.body};}
 const token=crypto.randomUUID();
 assert.equal((await api('host',{action:'import-bank',commandId:crypto.randomUUID(),revision:0,bank},token)).status,401);
 const first=await act('import-bank',{bank});assert.equal(first.result.questionCount,4);
 assert.equal((await api('host',first.cmd)).status,200);
 assert.equal((await api('host',{...first.cmd,bank:bank.map(q=>({...q,text:q.text+'不同'}))})).status,409);
 await restart();assert.equal((await api('state?role=host')).body.questionCount,4);
 await api('join',{token,nickname:'小明'});await act('start');
 const open=(await api('state?role=player',null,token)).body;assert.equal(open.question.text,'正式題目1');assert.equal(open.question.correct,undefined);
 const bad={action:'import-bank',commandId:crypto.randomUUID(),revision:open.revision,bank};assert.equal((await api('host',bad)).status,409);
 const lateToken=crypto.randomUUID();
 for(let i=0;i<4;i++){
  const s=(await api('state?role=player',null,token)).body;
  assert.equal((await api('answer',{questionId:s.question.id,choice:1},token)).status,200);await act('reveal');
  if(i===1){
   let breakState=(await api('state?role=screen',null,'')).body;assert.equal(breakState.phase,'round-end');assert.equal(breakState.leaderboard[0].score,520);
   assert.equal((await api('join',{token:lateToken,nickname:'中途加入'})).status,200);
   breakState=(await api('state?role=screen',null,'')).body;assert.equal(breakState.leaderboard.length,1);
   await restart();assert.equal((await api('state?role=player',null,lateToken)).body.phase,'round-end');
  }
  if(i===3){const round=(await api('state?role=screen',null,'')).body;assert.equal(round.phase,'round-end');assert.equal(round.leaderboard[0].score,260);}
  await act('next');
 }
 const old=(await api('state?role=player',null,token)).body;assert.equal(old.me.score,1040);
 const {cmd,result}=await act('new-session',{title:'正式家庭日'});assert.equal(result.playerCount,0);assert.equal(result.questionCount,4);assert.equal(result.phase,'waiting');
 assert.equal((await api('host',cmd)).body.sessionId,result.sessionId);
 assert.equal((await api('state?role=player',null,token)).status,401);
 await restart();assert.equal((await api('state?role=host')).body.sessionId,result.sessionId);
 assert.equal((await api('sessions',null,token)).status,401);
 const history=(await api('sessions')).body.sessions;assert.equal(history.length,2);
 const exported=await api('export?sessionId=legacy');assert.equal(exported.status,200,JSON.stringify(exported.body));assert.equal(exported.body.state.leaderboard[0].score,1040);assert.equal(exported.body.state.previousRounds[0].leaderboard.length,1);assert.equal(exported.body.players[0].score,260);assert.equal(exported.body.players[0].totalScore,1040);assert.equal(exported.body.bank.length,4);assert.equal(exported.body.players[0].roundResults[1].score,520);assert.equal(exported.body.players[0].roundResults[2].score,260);assert.equal(exported.body.state.previousRounds.length,2);
 assert.equal(exported.body.events.filter(e=>e.kind==='answered').length,4);assert.ok(!JSON.stringify(exported.body).includes(token));
 const newToken=crypto.randomUUID();await api('join',{token:newToken,nickname:'小明'});await act('start');
 assert.equal((await api('answer',{questionId:old.question.id,choice:1},newToken)).status,409);
 const next=(await api('state?role=player',null,newToken)).body;assert.equal(next.me.score,0);assert.notEqual(next.question.id,old.question.id);
 assert.equal((await api('export')).body.events.filter(e=>e.kind==='answered').length,0);
 console.log('PASS: server bank validation/digests, variable rounds, locked bank, persisted bank, idempotent new session, stale answers, old history and scores, restart recovery');
});
