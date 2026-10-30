import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshGame, join, answer, command, snapshot, getPlayer, leaderboard} from '../src/game.js';
import {QUESTIONS, POINTS} from '../src/questions.js';
const act = (s, action, extra={}) => command(s, {commandId:crypto.randomUUID(), revision:s.revision, action, ...extra});
function add(s,name='小明') { const token=crypto.randomUUID(); join(s,{token,nickname:name}); return getPlayer(s,token); }

test('unique names, idempotent joins and Unicode normalization', () => {
  const s=freshGame(), a=add(s), b=add(s);
  assert.match(b.name,/^小明-\d{4}$/);
  assert.equal(join(s,{token:a.token,nickname:'new'}),null);
  assert.equal(s.players.length,2);
  const c=add(s,'ＡＢＣ'), d=add(s,'ABC');
  assert.equal(c.name,'ABC'); assert.match(d.name,/^ABC-\d{4}$/);
});
test('fixed scoring, no leaks, duplicate receipts, unanswered and stale submissions', () => {
  const s=freshGame(), p=add(s), absent=add(s,'未作答'); act(s,'start');
  assert.equal(snapshot(s,'player',p).question.correct,undefined);
  answer(s,p,{questionId:QUESTIONS[0].id,choice:QUESTIONS[0].correct});
  assert.equal(p.score,0);
  assert.equal(answer(s,p,{questionId:QUESTIONS[0].id,choice:0}),null);
  act(s,'reveal'); assert.equal(p.score,POINTS); assert.equal(absent.score,0);
  assert.equal(answer(s,p,{questionId:QUESTIONS[0].id,choice:0}),null);
  assert.throws(()=>answer(s,absent,{questionId:QUESTIONS[0].id,choice:0}),/停止收答案/);
  act(s,'next'); assert.throws(()=>answer(s,p,{questionId:QUESTIONS[0].id,choice:0}),/題目已切換/);
  answer(s,p,{questionId:QUESTIONS[1].id,choice:0}); act(s,'reveal'); assert.equal(p.score,POINTS);
});
test('host command retries and stale competing controllers cannot double advance', () => {
  const s=freshGame(); add(s); act(s,'start');
  const c={commandId:crypto.randomUUID(), revision:s.revision,action:'reveal'};
  command(s,c); const version=s.version;
  assert.equal(command(s,c),null); assert.equal(s.version,version);
  assert.throws(()=>command(s,{...c,commandId:crypto.randomUUID()}),/進度已更新/);
  assert.throws(()=>act(s,'start'),/已開始/);
});
test('three rounds, tied ranks, final rank and tokens never in public snapshots', () => {
  const s=freshGame(), a=add(s), b=add(s); act(s,'start');
  for (const q of QUESTIONS) {
    answer(s,a,{questionId:q.id,choice:q.correct}); answer(s,b,{questionId:q.id,choice:q.correct});
    act(s,'reveal');
    if(q === QUESTIONS.at(-1)) {act(s,'final-rank',{playerId:a.id,rank:1});assert.throws(()=>act(s,'final-rank',{playerId:b.id,rank:1}),/已登記/);}
    act(s,'next');
  }
  assert.equal(s.phase,'finished'); assert.equal(a.score,3*POINTS);
  assert.equal(leaderboard(s).filter(p=>p.rank===1 && p.tied).length,2);
  assert.equal(a.score,3*POINTS);
  assert.ok(!JSON.stringify(snapshot(s,'screen')).includes(a.token));
  assert.throws(()=>add(s,'too late'),/已結束/);
});
test('350 player room capacity and storage value sizes', () => {
  const s=freshGame(); for(let i=0;i<350;i++) add(s,'小明');
  assert.throws(()=>add(s),/已滿/); act(s,'start');
  for(const p of s.players) answer(s,p,{questionId:QUESTIONS[0].id,choice:2});
  assert.ok(Buffer.byteLength(JSON.stringify(s.players)) < 128*1024);
  assert.ok(Buffer.byteLength(JSON.stringify(s.answers)) < 128*1024);
  act(s,'reveal'); assert.ok(s.players.every(p=>p.score===POINTS));
});


test('round scores and tie-breaks remain independent and survive session history', () => {
  const s=freshGame(), a=add(s), b=add(s,'小華'); act(s,'start');
  for (let i=0;i<QUESTIONS.length;i++) {
    const q=QUESTIONS[i];
    if(q.round===1 || q.round===3) answer(s,a,{questionId:q.id,choice:q.correct});
    if(q.round===2) answer(s,b,{questionId:q.id,choice:q.correct});
    act(s,'reveal');
    if(i===2) {act(s,'final-rank',{playerId:a.id,rank:1}); assert.throws(()=>act(s,'adjust-score',{playerId:a.id,delta:1,reason:'修正'}));}
    act(s,'next');
    if(i===2) {assert.equal(a.score,0);assert.equal(a.finalRank,null);assert.equal(a.roundResults[1].score,780);assert.equal(a.roundResults[1].finalRank,1);}
  }
  const view=snapshot(s,'host'); assert.equal(a.score,780); assert.equal(b.score,0);
  assert.equal(view.previousRounds[0].leaderboard[0].id,a.id);
  assert.equal(view.previousRounds[1].leaderboard[0].id,b.id);
  assert.equal(view.previousRounds[0].leaderboard[0].finalRank,1);
  const legacy=freshGame();delete legacy.scoreMode;const old=add(legacy);act(legacy,'start');
  for(const q of QUESTIONS){answer(legacy,old,{questionId:q.id,choice:q.correct});act(legacy,'reveal');act(legacy,'next');}
  assert.equal(old.score,2340);assert.equal(snapshot(legacy).scoreMode,'cumulative');
});


test('round-end pauses, late join does not change prior ranking, total only after host action',()=>{
 const s=freshGame(), early=add(s,'早到'), token=crypto.randomUUID(); act(s,'start');
 for(let i=0;i<3;i++){const q=QUESTIONS[i];answer(s,early,{questionId:q.id,choice:q.correct});act(s,'reveal');if(i<2)act(s,'next');}
 assert.equal(s.phase,'round-end');assert.equal(snapshot(s,'host').leaderboard[0].score,780);assert.deepEqual(snapshot(s,'screen').leaderboard,[]);
 join(s,{token,nickname:'中途加入'});const late=getPlayer(s,token);
 assert.equal(snapshot(s,'player',late).phase,'round-end');assert.equal(snapshot(s,'host').leaderboard.length,1);assert.equal(snapshot(s,'screen').leaderboard.length,0);
 assert.throws(()=>answer(s,late,{questionId:QUESTIONS[2].id,choice:0}),/停止收答案/);
 const step={action:'next',revision:s.revision,commandId:crypto.randomUUID()};command(s,step);assert.equal(command(s,step),null);
 assert.equal(s.phase,'open');assert.equal(s.index,3);assert.equal(early.score,0);assert.equal(late.score,0);
 const during=add(s,'答題中加入');answer(s,during,{questionId:QUESTIONS[3].id,choice:QUESTIONS[3].correct});
 for(let i=3;i<9;i++){const q=QUESTIONS[i];answer(s,late,{questionId:q.id,choice:q.correct});act(s,'reveal');if(i<8)act(s,'next');}
 assert.equal(s.phase,'round-end');assert.equal(snapshot(s,'host').leaderboard[0].score,780);assert.deepEqual(snapshot(s,'screen').leaderboard,[]);
 assert.equal(snapshot(s,'player',late).me.score,1560);assert.equal(snapshot(s,'screen').previousRounds,undefined);
 act(s,'next');const final=snapshot(s,'screen');assert.equal(s.phase,'finished');assert.equal(final.leaderboard[0].id,late.id);assert.equal(final.leaderboard[0].score,1560);assert.equal(final.leaderboard[1].score,780);assert.equal(final.leaderboard[2].score,260);
 assert.equal(snapshot(s,'player',late).me.score,1560);assert.equal(snapshot(s,'host').previousRounds[0].leaderboard.length,1);assert.equal(final.previousRounds,undefined);
 assert.throws(()=>add(s,'結束後'),/已結束/);
});

test('round scores and rankings are not sent to players or projection before finish',()=>{
 const s=freshGame(),p=add(s);act(s,'start');
 for(let i=0;i<3;i++){const q=QUESTIONS[i];answer(s,p,{questionId:q.id,choice:q.correct});act(s,'reveal');if(i<2)act(s,'next');}
 assert.equal(s.phase,'round-end');
 for(const role of ['player','screen']){const v=snapshot(s,role,role==='player'?p:null);assert.deepEqual(v.leaderboard,[]);assert.equal(v.previousRounds,undefined);if(v.me)assert.equal(v.me.finalRank,null);}
 act(s,'next');const q=QUESTIONS[3];answer(s,p,{questionId:q.id,choice:q.correct});act(s,'reveal');assert.equal(snapshot(s,'player',p).me.score,1040);
});

test('projection receives at most 40 final entries and flags ties',()=>{
 const s=freshGame();for(let i=0;i<42;i++)add(s,`玩家${i}`);s.phase='finished';s.index=QUESTIONS.length-1;
 const publicView=snapshot(s,'screen');assert.equal(publicView.leaderboard.length,40);assert.ok(publicView.leaderboard.every(e=>e.tied&&e.rank===1));assert.equal(publicView.previousRounds,undefined);
 assert.equal(snapshot(s,'host').leaderboard.length,42);
});
