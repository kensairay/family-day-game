import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshGame, join, getPlayer, answer, command, snapshot} from '../src/game.js';
import {QUESTIONS, POINTS} from '../src/questions.js';
const act=(s,action,extra={})=>command(s,{commandId:crypto.randomUUID(),revision:s.revision,action,...extra});
function setup(){const s=freshGame();for(const name of ['已作答','待作答'])join(s,{token:crypto.randomUUID(),nickname:name});act(s,'start');return s;}
function submit(s,p=s.players[0]){return answer(s,p,{questionId:QUESTIONS[s.index].id,choice:QUESTIONS[s.index].correct});}

test('pause keeps receipts, hides correct answer and refuses only NEW submissions with 423',()=>{
 const s=setup(),[a,b]=s.players;submit(s,a);act(s,'pause');
 assert.equal(s.phase,'paused');assert.equal(a.score,0);assert.equal(snapshot(s,'player',a).question.correct,undefined);
 assert.equal(submit(s,a),null);
 assert.throws(()=>submit(s,b),e=>e.status===423 && /暫停/.test(e.message));
 const before=structuredClone(s);assert.throws(()=>act(s,'reveal'));assert.deepEqual(s,before);
 act(s,'resume');submit(s,b);act(s,'reveal');assert.equal(a.score,POINTS);assert.equal(b.score,POINTS);
});
test('pause/resume cannot restart a revealed or waiting question',()=>{
 const waiting=freshGame();assert.throws(()=>act(waiting,'pause'));
 const s=setup();assert.throws(()=>act(s,'resume'));act(s,'pause');assert.throws(()=>act(s,'pause'));
 act(s,'resume');act(s,'reveal');assert.throws(()=>act(s,'pause'));assert.throws(()=>act(s,'resume'));
});
test('skip voids current question, stays put, reveals no correct answer, and advances only once',()=>{
 const s=setup();submit(s);act(s,'pause');const event=act(s,'skip',{reason:'投影題目有誤'});
 assert.equal(s.phase,'skipped');assert.equal(s.index,0);assert.ok(s.players.every(p=>p.score===0));
 assert.equal(event.data.reason,'投影題目有誤');assert.equal(snapshot(s).question.correct,undefined);
 assert.equal(submit(s),null);assert.throws(()=>submit(s,s.players[1]),e=>e.status===409);
 assert.throws(()=>act(s,'reveal'));act(s,'next');assert.equal(s.index,1);assert.equal(s.phase,'open');assert.deepEqual(s.answers,{});
});
test('last question can be skipped without revealing its answer or adding points',()=>{
 const s=setup();for(let i=0;i<QUESTIONS.length-1;i++){act(s,'reveal');act(s,'next');}
 submit(s);act(s,'skip',{reason:'活動時間不足'});assert.equal(s.phase,'skipped');act(s,'next');
 assert.equal(s.phase,'finished');assert.equal(snapshot(s).question.correct,undefined);assert.equal(s.players[0].score,0);
});
test('skip reason required and rejected operation changes nothing',()=>{
 const s=setup(),before=structuredClone(s);
 for(const reason of ['', '   ', 'x'.repeat(121), null]){assert.throws(()=>act(s,'skip',{reason}));assert.deepEqual(s,before);}
});
test('adjustment has a before/after audit, preserves question scoring and updates host roster while paused',()=>{
 const s=setup(),p=s.players[0];submit(s);assert.throws(()=>act(s,'adjust-score',{playerId:p.id,delta:260,reason:'補分'}));
 act(s,'pause');assert.equal(snapshot(s,'host').leaderboard.length,2);
 const event=act(s,'adjust-score',{playerId:p.id,delta:260,reason:'現場補分'});
 assert.equal(p.score,260);assert.deepEqual(event.data,{action:'adjust-score',playerId:p.id,before:0,delta:260,after:260,reason:'現場補分'});
 act(s,'resume');act(s,'reveal');assert.equal(p.score,520);
 act(s,'adjust-score',{playerId:p.id,delta:-260,reason:'更正補分'});assert.equal(p.score,260);
});
test('score adjustments reject invalid values, unknown player, empty reason and negative result atomically',()=>{
 const s=setup();act(s,'pause');const p=s.players[0],before=structuredClone(s);
 for(const delta of [0,-1,0.5,10001,Infinity,'260']){assert.throws(()=>act(s,'adjust-score',{playerId:p.id,delta,reason:'測試'}));assert.deepEqual(s,before);}
 for(const extra of [{playerId:'missing',delta:260,reason:'補分'},{playerId:p.id,delta:260,reason:''}]){assert.throws(()=>act(s,'adjust-score',extra));assert.deepEqual(s,before);}
});
test('same command payload retry is idempotent; reused ID with changed intent is rejected',()=>{
 const s=setup();act(s,'pause');const p=s.players[0];
 const cmd={action:'adjust-score',commandId:crypto.randomUUID(),revision:s.revision,playerId:p.id,delta:260,reason:'補分'};
 command(s,cmd);const before=structuredClone(s);assert.equal(command(s,cmd),null);assert.deepEqual(s,before);
 assert.throws(()=>command(s,{...cmd,delta:520}),e=>e.status===409);assert.deepEqual(s,before);
 assert.throws(()=>command(s,{...cmd,commandId:crypto.randomUUID()}),e=>e.status===409);assert.deepEqual(s,before);
});
test('recorded final ranks cannot be made stale by changing scores',()=>{
 const s=setup();for(const q of QUESTIONS){act(s,'reveal');act(s,'next');}
 act(s,'adjust-score',{playerId:s.players[0].id,delta:260,reason:'補分'});
 act(s,'final-rank',{playerId:s.players[0].id,rank:1});const before=structuredClone(s);
 assert.throws(()=>act(s,'adjust-score',{playerId:s.players[1].id,delta:520,reason:'補分'}),/決勝/);assert.deepEqual(s,before);
});
