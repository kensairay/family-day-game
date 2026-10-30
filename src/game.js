import {QUESTIONS, POINTS} from './questions.js';
import {validateBank} from '../shared/question-bank.js';

export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const freshGame = () => ({phase:'waiting', index:0, version:0, revision:0, players:[], answers:{}, commands:[], commandRecords:[], voided:false, bank:structuredClone(QUESTIONS), sessionId:'legacy', sessionTitle:'初始場次', sessionCreatedAt:null, scoreMode:'per-round'});
export const questionsFor = state => state.bank || QUESTIONS;
export const sessionFor = state => state.sessionId || 'legacy';
export const currentQuestion = state => {
 const q=questionsFor(state)[state.index];
 return {...q,id:sessionFor(state)==='legacy'?q.id:`${sessionFor(state)}:${q.id}`};
};
export function getPlayer(state, token) {
  return state.players.find(p => p.token === token);
}
export function join(state, {token, nickname}, now = new Date().toISOString()) {
  if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token)) throw new GameError('無效的玩家識別碼');
  const existing = getPlayer(state, token);
  if (existing) return null; // A lost join response or reload must not create a second player.
  if (state.phase === 'finished') throw new GameError('活動已結束，無法新增玩家', 409);
  if (state.players.length >= 350) throw new GameError('活動已滿，請洽工作人員', 409);
  if (typeof nickname !== 'string') throw new GameError('請輸入暱稱');
  const base = Array.from(nickname.normalize('NFKC').trim().replace(/[\p{Cc}\p{Cf}]/gu, '')).slice(0,10).join('') || '小隊員';
  let name = base;
  while (state.players.some(p => p.name === name)) {
    const random = new Uint32Array(1); crypto.getRandomValues(random);
    name = `${base}-${1000 + random[0] % 9000}`;
  }
  const player = {id:crypto.randomUUID(), token, name, score:0, finalRank:null, joinedAtIndex:state.index+(state.phase === 'round-end' ? 1 : 0)};
  state.players.push(player); state.version++;
  return {kind:'joined', at:now, data:{playerId:player.id, name}};
}
export function answer(state, player, {questionId, choice}, now = new Date().toISOString()) {
  if (!Number.isInteger(choice) || choice < 0 || choice >= currentQuestion(state).options.length) throw new GameError('請選擇有效答案');
  if (questionId !== currentQuestion(state).id) throw new GameError('題目已切換，請查看目前題目', 409);
  // Retry after reveal still returns the original receipt, but never accepts a new answer.
  const receipt = state.answers[player.id];
  if (receipt) return null;
  if (state.phase === 'paused') throw new GameError('遊戲暫停，恢復後會重新送出答案', 423);
  if (state.phase !== 'open') throw new GameError('本題已停止收答案', 409);
  state.answers[player.id] = {choice, receivedAt:now}; state.version++;
  return {kind:'answered', at:now, data:{playerId:player.id, questionId, choice}};
}
function operationReason(value) {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > 120) throw new GameError('請填寫 1～120 字的操作理由');
  return value.trim();
}
function fingerprint(body) {
  return JSON.stringify({action:body.action, revision:body.revision, playerId:body.playerId ?? null,
    rank:body.rank ?? null, delta:body.delta ?? null, reason:body.reason ?? null, title:body.title ?? null, bankDigest:body.bankDigest ?? null});
}
export function command(state, body, now = new Date().toISOString()) {
  if (typeof body.commandId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.commandId)) throw new GameError('無效的主持人操作識別碼');
  const intent = fingerprint(body);
  if (state.commands.includes(body.commandId)) {
    const previous = (state.commandRecords || []).find(record => record.id === body.commandId);
    if (previous && fingerprint(JSON.parse(previous.intent)) !== intent) throw new GameError('同一操作識別碼不能用於不同內容', 409);
    return null;
  }
  if (body.revision !== state.revision) throw new GameError('進度已更新，請確認最新畫面再操作', 409);
  const action = body.action;
  let data = {action};
  if (action === 'import-bank') {
    if (state.phase !== 'waiting') throw new GameError('遊戲開始後不能修改題庫',409);
    if (typeof body.bankDigest !== 'string' || !/^[0-9a-f]{64}$/.test(body.bankDigest)) throw new GameError('缺少伺服器題庫校驗');
    state.bank=validateBank(body.bank);state.index=0;
    data={...data,questionCount:state.bank.length,bankDigest:body.bankDigest};
  } else if (action === 'new-session') {
    if (state.phase !== 'finished' && !(state.phase==='waiting' && state.players.length===0)) throw new GameError('請先結束本場，再建立新場次',409);
    const title=typeof body.title==='string'?body.title.trim():'';
    if(!title||Array.from(title).length>40)throw new GameError('請填寫 1～40 字的場次名稱');
    const previousSessionId=sessionFor(state),bank=structuredClone(questionsFor(state));
    Object.assign(state,{phase:'waiting',index:0,players:[],answers:{},voided:false,bank,sessionId:crypto.randomUUID(),sessionTitle:title,sessionCreatedAt:now,scoreMode:'per-round'});
    data={...data,previousSessionId,sessionId:state.sessionId,title};
  } else if (action === 'start') {
    if (state.phase !== 'waiting') throw new GameError('遊戲已開始', 409);
    state.phase = 'open';
  } else if (action === 'pause') {
    if (state.phase !== 'open') throw new GameError('只能暫停正在收答案的題目', 409);
    state.phase = 'paused';
    data = {...data, questionId:currentQuestion(state).id};
  } else if (action === 'resume') {
    if (state.phase !== 'paused') throw new GameError('目前沒有暫停中的題目', 409);
    state.phase = 'open';
    data = {...data, questionId:currentQuestion(state).id};
  } else if (action === 'skip') {
    if (!['open','paused'].includes(state.phase)) throw new GameError('只能跳過正在作答或暫停的題目', 409);
    const reason = operationReason(body.reason);
    state.phase = state.scoreMode === 'per-round' && questionsFor(state)[state.index+1]?.round !== currentQuestion(state).round ? 'round-end' : 'skipped'; state.voided = true;
    data = {...data, questionId:currentQuestion(state).id, reason};
  } else if (action === 'adjust-score') {
    if (!['paused','revealed','skipped','round-end'].includes(state.phase) && !(state.phase === 'finished' && state.scoreMode !== 'per-round')) throw new GameError('請先暫停或收題，再調整分數', 409);
    if (state.players.some(p => p.finalRank !== null)) throw new GameError('已登記決勝名次，不能再調整積分', 409);
    const player = state.players.find(p => p.id === body.playerId);
    const reason = operationReason(body.reason);
    if (!player || !Number.isSafeInteger(body.delta) || body.delta === 0 || Math.abs(body.delta) > 10000) throw new GameError('請選擇玩家並輸入非零整數分數（最多正負 10000 分）');
    const before = player.score, after = before + body.delta;
    if (!Number.isSafeInteger(after) || after < 0 || after > 1000000) throw new GameError('調整後分數必須介於 0～1000000 分');
    player.score = after;
    data = {...data, playerId:player.id, before, delta:body.delta, after, reason};
  } else if (action === 'reveal') {
    if (state.phase !== 'open') throw new GameError('目前沒有開放作答的題目', 409);
    state.phase = state.scoreMode === 'per-round' && questionsFor(state)[state.index+1]?.round !== currentQuestion(state).round ? 'round-end' : 'revealed';
    const correct = currentQuestion(state).correct;
    for (const p of state.players) if (state.answers[p.id]?.choice === correct) p.score += POINTS;
    data = {...data, questionId:currentQuestion(state).id, correct, scores:state.players.map(p => ({playerId:p.id, score:p.score}))};
  } else if (action === 'next') {
    if (!['revealed','skipped','round-end'].includes(state.phase)) throw new GameError('請先公布答案或確認跳題', 409);
    if (state.scoreMode === 'per-round' && questionsFor(state)[state.index+1]?.round !== currentQuestion(state).round && state.phase !== 'round-end') state.phase = 'round-end';
    else if (state.index === questionsFor(state).length - 1) state.phase = 'finished';
    else {
      const previousRound=currentQuestion(state).round;
      if (state.scoreMode === 'per-round' && questionsFor(state)[state.index+1].round !== previousRound) {
        for (const p of state.players) {
          p.roundResults = {...p.roundResults, [previousRound]:{score:p.score, finalRank:p.finalRank}};
          p.score=0; p.finalRank=null;
        }
      }
      state.index++; state.answers = {}; state.phase = 'open'; state.voided = false;
    }
  } else if (action === 'final-rank') {
    if (state.scoreMode === 'per-round' ? state.phase !== 'round-end' : state.phase !== 'finished') throw new GameError('請在回合結束後登記決勝名次', 409);
    const player = state.players.find(p => p.id === body.playerId);
    if (!player || !Number.isInteger(body.rank) || body.rank < 1 || body.rank > state.players.length) throw new GameError('請選擇玩家並輸入有效名次');
    if (state.players.some(p => p.id !== player.id && p.finalRank === body.rank)) throw new GameError('這個最終名次已登記給其他玩家');
    player.finalRank = body.rank;
    data = {...data, playerId:player.id, rank:body.rank};
  } else throw new GameError('不支援的主持人操作');
  state.revision++; state.version++;
  state.commands.push(body.commandId); state.commands = state.commands.slice(-32);
  state.commandRecords = [...(state.commandRecords || []), {id:body.commandId, intent}].slice(-32);
  return {kind:'host-command', at:now, data};
}
export function leaderboard(state, round = null) {
  let rank = 0;
  const endIndex = round === null ? state.index : questionsFor(state).findLastIndex(q => q.round === round);
  let players = state.players;
  if (round !== 'total') players = players.filter(p => (p.joinedAtIndex ?? 0) <= endIndex);
  if (round === 'total') players = players.map(p => ({...p, score:p.score + Object.values(p.roundResults || {}).reduce((sum, result) => sum + result.score, 0), finalRank:null}));
  else if (round !== null) players = players.map(p => ({...p, score:p.roundResults?.[round]?.score ?? 0, finalRank:p.roundResults?.[round]?.finalRank ?? null}));
  const sorted = [...players].sort((a,b) => b.score - a.score || a.name.localeCompare(b.name,'zh-Hant'));
  const counts = new Map(); sorted.forEach(p => counts.set(p.score, (counts.get(p.score) || 0) + 1));
  return sorted.map((p, i) => {
    if (i === 0 || p.score !== sorted[i-1].score) rank = i + 1;
    return {id:p.id, name:p.name, score:p.score, rank, tied:counts.get(p.score) > 1, finalRank:p.finalRank};
  });
}
export function snapshot(state, role = 'screen', player = null) {
  const q = currentQuestion(state);
  const revealed = ['revealed','round-end','finished'].includes(state.phase) && !state.voided;
  const total = state.scoreMode === 'per-round' && state.phase === 'finished';
  return {
    version:state.version, revision:state.revision, phase:state.phase, points:POINTS, voided:Boolean(state.voided),
    sessionId:sessionFor(state),sessionTitle:state.sessionTitle || '初始場次', scoreMode:state.scoreMode || 'cumulative',
    ...(role === 'host' && state.scoreMode === 'per-round' && state.phase === 'finished' ? {previousRounds:[...new Set(questionsFor(state).map(q=>q.round))].map(round=>({round,name:questionsFor(state).find(q=>q.round===round).roundName,leaderboard:round===currentQuestion(state).round ? leaderboard(state) : leaderboard(state,round)}))} : {}),
    roundCount:new Set(questionsFor(state).map(q=>q.round)).size, questionCount:questionsFor(state).length, position:state.index+1,
    question:state.phase === 'waiting' ? null : {
      id:q.id, text:q.text, options:q.options, round:q.round, number:q.number, roundName:q.roundName,lastInRound:questionsFor(state)[state.index+1]?.round!==q.round,
      ...(revealed ? {correct:q.correct} : {})
    },
    ...(role === 'host' ? {bankSummary:{questionCount:questionsFor(state).length,rounds:[...new Set(questionsFor(state).map(q=>q.round))].map(number=>({number,name:questionsFor(state).find(q=>q.round===number)?.roundName,count:questionsFor(state).filter(q=>q.round===number).length}))}} : {}),
    ...(role !== 'player' ? {playerCount:state.players.length, answeredCount:Object.keys(state.answers).length} : {}),
    leaderboard:role === 'host' ? leaderboard(state,total ? 'total' : null) : state.phase === 'finished' ? (role === 'screen' ? leaderboard(state,total ? 'total' : null).filter(entry=>entry.rank<=40) : leaderboard(state,total ? 'total' : null)) : [],
    ...(player ? {me:{id:player.id, name:player.name, score:state.scoreMode === 'per-round' ? player.score + Object.values(player.roundResults || {}).reduce((sum, result) => sum + result.score, 0) : player.score, finalRank:role === 'player' ? null : player.finalRank, answer:state.answers[player.id] ?? null}} : {})
  };
}
