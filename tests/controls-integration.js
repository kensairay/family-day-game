import assert from 'node:assert/strict';
import {withServer, HOST_KEY} from './server.js';
await withServer(async (url,{restart})=>{
 const prefix=url+'/api/rooms/family-day/';
 async function api(path,body,token=HOST_KEY){const r=await fetch(prefix+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
 async function act(action,extra={}){const s=(await api('state?role=host')).body;const cmd={action,revision:s.revision,commandId:crypto.randomUUID(),...extra};const result=await api('host',cmd);assert.equal(result.status,200,JSON.stringify(result.body));return {cmd,result};}
 const aToken=crypto.randomUUID(),bToken=crypto.randomUUID();
 const a=(await api('join',{token:aToken,nickname:'已收到'})).body.me;
 await api('join',{token:bToken,nickname:'待送出'});
 await act('start');await api('answer',{questionId:'r1q1',choice:2},aToken);
 await act('pause');
 assert.equal((await api('answer',{questionId:'r1q1',choice:2},bToken)).status,423);
 assert.equal((await api('answer',{questionId:'r1q1',choice:0},aToken)).body.me.answer.choice,2);
 assert.equal((await api('state?role=screen',null,'')).body.question.correct,undefined);
 assert.equal((await api('host',{action:'resume',commandId:crypto.randomUUID(),revision:2},bToken)).status,401);
 const {cmd}=await act('adjust-score',{playerId:a.id,delta:260,reason:'網路補分'});
 await restart();
 let state=(await api('state?role=player',null,aToken)).body;
 assert.equal(state.phase,'paused');assert.equal(state.me.score,260);assert.equal(state.me.answer.choice,2);
 assert.equal((await api('host',cmd)).status,200);
 assert.equal((await api('host',{...cmd,delta:520})).status,409);
 const stale={action:'resume',commandId:crypto.randomUUID(),revision:cmd.revision};
 assert.equal((await api('host',stale)).status,409);
 await act('resume');await api('answer',{questionId:'r1q1',choice:2},bToken);await act('reveal');
 assert.equal((await api('state?role=player',null,aToken)).body.me.score,520);
 await act('adjust-score',{playerId:a.id,delta:-260,reason:'核對後更正'});
 state=(await api('state?role=host')).body;
 assert.ok(state.leaderboard.every(entry=>entry.rank===1 && entry.tied));
 await act('next');await api('answer',{questionId:'r1q2',choice:1},aToken);
 await act('skip',{reason:'題目有誤'});
 state=(await api('state?role=player',null,aToken)).body;
 assert.equal(state.phase,'skipped');assert.equal(state.me.score,260);assert.equal(state.question.correct,undefined);
 assert.equal((await api('answer',{questionId:'r1q2',choice:1},bToken)).status,409);
 assert.equal((await api('host',{action:'reveal',revision:state.revision,commandId:crypto.randomUUID()})).status,409);
 await act('next');
 for(let i=2;i<9;i++){await act('skip',{reason:'時間調整'});if(i===8)await act('final-rank',{playerId:a.id,rank:1});await act('next');}
 state=(await api('state?role=host')).body;assert.equal(state.phase,'finished');assert.equal(state.question.correct,undefined);
 state=(await api('state?role=host')).body;
 assert.equal((await api('host',{action:'adjust-score',revision:state.revision,commandId:crypto.randomUUID(),playerId:a.id,delta:260,reason:'過期更正'})).status,409);
 const exportResponse=await api('export');assert.equal(exportResponse.status,200,JSON.stringify(exportResponse.body));const exported=exportResponse.body;
 const adjustments=exported.events.filter(e=>e.data.action==='adjust-score');
 assert.equal(adjustments.length,2);assert.deepEqual(adjustments.map(e=>[e.data.before,e.data.delta,e.data.after]),[[0,260,260],[520,-260,260]]);
 assert.equal(exported.events.filter(e=>e.data.action==='skip').length,8);
 console.log('PASS: host-only controls, paused receipts/423, adjustment audit/idempotency, stale commands, paused process restart, voided questions, final rank protection');
});
