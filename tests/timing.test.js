import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshGame,join,getPlayer,command,answer,snapshot} from '../src/game.js';
import {QUESTIONS} from '../src/questions.js';
const at=ms=>new Date(1700000000000+ms).toISOString();
const act=(s,action,extra={},ms=0)=>command(s,{action,revision:s.revision,commandId:crypto.randomUUID(),...extra},at(ms));
const add=(s,name)=>{const token=crypto.randomUUID();join(s,{token,nickname:name});return getPlayer(s,token)};
const timed=()=>{const s=freshGame();act(s,'set-round-times',{roundTimes:{1:10,2:15,3:0}});return s};
test('server enforces deadline and speed points, including idempotent retries',()=>{
 const s=timed(),a=add(s,'快'),b=add(s,'慢'),c=add(s,'逾時');act(s,'start',{},0);
 answer(s,a,{questionId:QUESTIONS[0].id,choice:QUESTIONS[0].correct},at(0));
 answer(s,b,{questionId:QUESTIONS[0].id,choice:QUESTIONS[0].correct},at(5000));
 assert.throws(()=>answer(s,c,{questionId:QUESTIONS[0].id,choice:0},at(10000)),/時間已結束/);
 assert.equal(answer(s,a,{questionId:QUESTIONS[0].id,choice:0},at(20000)),null);
 act(s,'reveal',{},11000);assert.equal(a.score,260);assert.equal(b.score,195);assert.equal(c.score,0);
 act(s,'next',{},12000);assert.equal(s.timer.deadline,1700000022000);
});
test('pause excludes paused time from speed and restores remaining deadline',()=>{
 const s=timed(),a=add(s,'甲');act(s,'start',{},0);act(s,'pause',{},3000);assert.equal(s.timer.pausedRemaining,7000);
 assert.throws(()=>answer(s,a,{questionId:QUESTIONS[0].id,choice:QUESTIONS[0].correct},at(4000)),/暫停/);
 act(s,'resume',{},23000);assert.equal(s.timer.deadline,1700000030000);
 answer(s,a,{questionId:QUESTIONS[0].id,choice:QUESTIONS[0].correct},at(25000));act(s,'reveal',{},25001);assert.equal(a.score,195);
});
test('early end settles only accepted answers once and retains prior round results',()=>{
 const s=timed(),a=add(s,'甲'),b=add(s,'乙');act(s,'start');
 answer(s,a,{questionId:QUESTIONS[0].id,choice:QUESTIONS[0].correct},at(1000));
 answer(s,b,{questionId:QUESTIONS[0].id,choice:(QUESTIONS[0].correct+1)%4},at(2000));
 const c={action:'end-early',revision:s.revision,commandId:crypto.randomUUID()};command(s,c,at(3000));const score=a.score;assert.equal(score,247);assert.equal(b.score,0);assert.equal(s.phase,'finished');assert.equal(command(s,c,at(3001)),null);assert.equal(a.score,score);
 const v=snapshot(s,'host');assert.equal(v.previousRounds.length,1);assert.equal(v.leaderboard[0].score,247);
});
test('round time config is validated and locked after start',()=>{
 const s=freshGame();assert.throws(()=>act(s,'set-round-times',{roundTimes:{1:15,2:-1,3:10}}),/秒數/);
 assert.throws(()=>act(s,'set-round-times',{roundTimes:{1:15}}),/秒數/);
 act(s,'set-round-times',{roundTimes:{1:15,2:10,3:0}});act(s,'start');assert.throws(()=>act(s,'set-round-times',{roundTimes:{1:1,2:1,3:1}}),/開始後/);
});

test('next round applies its own configured duration',()=>{
 const s=timed(),a=add(s,'甲');act(s,'start',{},0);
 for(let i=0;i<3;i++){answer(s,a,{questionId:QUESTIONS[i].id,choice:QUESTIONS[i].correct},at(i*1000+100));act(s,'reveal',{},i*1000+200);if(i<2)act(s,'next',{},i*1000+300);}
 assert.equal(s.phase,'round-end');act(s,'next',{},4000);assert.equal(s.timer.durationMs,15000);assert.equal(s.timer.deadline,1700000019000);
});
