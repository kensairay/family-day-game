import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshGame,command,snapshot,join,getPlayer,answer,currentQuestion} from '../src/game.js';
import {normalizeWorkbookRows,validateBank} from '../shared/question-bank.js';
const header=['回合','回合名稱','題目','選項A','選項B','選項C','選項D','正確答案'];
const rows=()=>[header,...[1,1,2,3].map((r,i)=>[r,`回合${r}`,`正式題目${i+1}`,'甲','乙','丙','丁','B'])];
const act=(s,action,extra={})=>command(s,{action,commandId:crypto.randomUUID(),revision:s.revision,...extra});
const load=(s,bank)=>act(s,'import-bank',{bank,bankDigest:'1'.repeat(64)});

test('xlsx row schema normalizes variable-length three-round bank',()=>{
 const bank=normalizeWorkbookRows(rows());assert.equal(bank.length,4);assert.deepEqual(bank.map(q=>q.id),['r1q1','r1q2','r2q1','r3q1']);assert.equal(bank[0].correct,1);
 const s=freshGame();load(s,bank);assert.equal(snapshot(s).questionCount,4);assert.equal(snapshot(s).roundCount,3);
 act(s,'start');assert.equal(snapshot(s).question.lastInRound,false);act(s,'reveal');act(s,'next');assert.equal(snapshot(s).question.lastInRound,true);
});
test('row errors include source row and reject wrong headers, missing rounds, duplicate choices and invalid answer',()=>{
 assert.throws(()=>normalizeWorkbookRows([['wrong'],...rows().slice(1)]),/欄位/);
 const invalid=rows();invalid[2][7]='E';invalid[3][4]='甲';
 assert.throws(()=>normalizeWorkbookRows(invalid),e=>e.details.some(x=>x.row===3)&&e.details.some(x=>x.row===4));
 assert.throws(()=>normalizeWorkbookRows(rows().slice(0,4)),/三回合/);
 assert.throws(()=>validateBank(Array.from({length:61},()=>({}))),/60/);
});
test('question bank imports are validated before mutation and locked once started',()=>{
 const s=freshGame();load(s,normalizeWorkbookRows(rows()));const before=structuredClone(s);
 assert.throws(()=>load(s,[]));assert.deepEqual(s,before);act(s,'start');const started=structuredClone(s);
 assert.throws(()=>load(s,normalizeWorkbookRows(rows())),/開始/);assert.deepEqual(s,started);
});
test('new session keeps approved bank, clears players and scores, and retries are idempotent',()=>{
 const s=freshGame();load(s,normalizeWorkbookRows(rows()));const token=crypto.randomUUID();join(s,{token,nickname:'小明'});act(s,'start');
 assert.throws(()=>act(s,'new-session',{title:'新場'}),/結束/);
 for(let i=0;i<4;i++){answer(s,getPlayer(s,token),{questionId:currentQuestion(s).id,choice:1});act(s,'reveal');act(s,'next');}
 const oldQuestionId=currentQuestion(s).id, oldVersion=s.version;
 const cmd={action:'new-session',title:'正式家庭日',commandId:crypto.randomUUID(),revision:s.revision};command(s,cmd);
 assert.equal(s.phase,'waiting');assert.equal(s.sessionTitle,'正式家庭日');assert.equal(s.players.length,0);assert.deepEqual(s.answers,{});assert.equal(s.bank.length,4);assert.ok(s.version>oldVersion);
 const saved=structuredClone(s);assert.equal(command(s,cmd),null);assert.deepEqual(s,saved);
 const newToken=crypto.randomUUID();join(s,{token:newToken,nickname:'小明'});act(s,'start');assert.notEqual(currentQuestion(s).id,oldQuestionId);
 assert.throws(()=>answer(s,getPlayer(s,newToken),{questionId:oldQuestionId,choice:1}),/題目已切換/);assert.equal(getPlayer(s,newToken).score,0);
});
test('waiting session with joined players cannot be replaced accidentally',()=>{
 const s=freshGame();join(s,{token:crypto.randomUUID(),nickname:'等待中'});const before=structuredClone(s);
 assert.throws(()=>act(s,'new-session',{title:'不能覆蓋'}));assert.deepEqual(s,before);
});
test('new title is required and question answers never leak before reveal',()=>{
 const s=freshGame();assert.throws(()=>act(s,'new-session',{title:''}));load(s,normalizeWorkbookRows(rows()));act(s,'start');
 assert.equal(snapshot(s,'screen').question.correct,undefined);assert.equal(snapshot(s,'player').bank,undefined);
 assert.equal(snapshot(s,'host').bankSummary.rounds[0].count,2);
});

test('old persisted command fingerprints remain idempotent after upgrade',()=>{
 const s=freshGame();const body={action:'start',commandId:crypto.randomUUID(),revision:0};command(s,body);
 const record=s.commandRecords[0],old=JSON.parse(record.intent);delete old.title;delete old.bankDigest;record.intent=JSON.stringify(old);
 const version=s.version;assert.equal(command(s,body),null);assert.equal(s.version,version);
});

test('blank, multi-letter and numeric Excel answers are never silently converted to A',()=>{
 for(const value of ['',null,undefined,'AB','ABC','BCD',1]){
  const invalid=rows();invalid[1][7]=value;
  assert.throws(()=>normalizeWorkbookRows(invalid),e=>e.details?.some(d=>d.row===2&&/正確答案/.test(d.message)));
 }
 const valid=rows();valid[1][7]=' b ';assert.equal(normalizeWorkbookRows(valid)[0].correct,1);
});
test('Excel numeric options become display text without changing answer semantics',()=>{
 const input=rows();input[1].splice(3,4,2023,2024,2025,2026);
 assert.deepEqual(normalizeWorkbookRows(input)[0].options,['2023','2024','2025','2026']);
 const duplicate=rows();duplicate[1].splice(3,4,0,'0',2,3);assert.throws(()=>normalizeWorkbookRows(duplicate),/驗證/);
});
