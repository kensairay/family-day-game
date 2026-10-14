import {QUESTIONS, POINTS, ROUNDS} from './questions.js';

export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const freshGame = () => ({phase:'waiting', index:0, version:0, revision:0, players:[], answers:{}, commands:[]});
export const currentQuestion = state => QUESTIONS[state.index];
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
  const player = {id:crypto.randomUUID(), token, name, score:0, finalRank:null};
  state.players.push(player); state.version++;
  return {kind:'joined', at:now, data:{playerId:player.id, name}};
}
export function answer(state, player, {questionId, choice}, now = new Date().toISOString()) {
  if (!Number.isInteger(choice) || choice < 0 || choice >= currentQuestion(state).options.length) throw new GameError('請選擇有效答案');
  if (questionId !== currentQuestion(state).id) throw new GameError('題目已切換，請查看目前題目', 409);
  // Retry after reveal still returns the original receipt, but never accepts a new answer.
  const receipt = state.answers[player.id];
  if (receipt) return null;
  if (state.phase !== 'open') throw new GameError('本題已停止收答案', 409);
  state.answers[player.id] = {choice, receivedAt:now}; state.version++;
  return {kind:'answered', at:now, data:{playerId:player.id, questionId, choice}};
}
export function command(state, body, now = new Date().toISOString()) {
  if (typeof body.commandId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.commandId)) throw new GameError('無效的主持人操作識別碼');
  if (state.commands.includes(body.commandId)) return null;
  if (body.revision !== state.revision) throw new GameError('進度已更新，請確認最新畫面再操作', 409);
  const action = body.action;
  let data = {action};
  if (action === 'start') {
    if (state.phase !== 'waiting') throw new GameError('遊戲已開始', 409);
    state.phase = 'open';
  } else if (action === 'reveal') {
    if (state.phase !== 'open') throw new GameError('目前沒有開放作答的題目', 409);
    state.phase = 'revealed';
    const correct = currentQuestion(state).correct;
    for (const p of state.players) if (state.answers[p.id]?.choice === correct) p.score += POINTS;
    data = {...data, questionId:currentQuestion(state).id, correct, scores:state.players.map(p => ({playerId:p.id, score:p.score}))};
  } else if (action === 'next') {
    if (state.phase !== 'revealed') throw new GameError('請先公布答案', 409);
    if (state.index === QUESTIONS.length - 1) state.phase = 'finished';
    else { state.index++; state.answers = {}; state.phase = 'open'; }
  } else if (action === 'final-rank') {
    if (state.phase !== 'finished') throw new GameError('請在遊戲結束後登記決勝名次', 409);
    const player = state.players.find(p => p.id === body.playerId);
    if (!player || !Number.isInteger(body.rank) || body.rank < 1 || body.rank > state.players.length) throw new GameError('請選擇玩家並輸入有效名次');
    if (state.players.some(p => p.id !== player.id && p.finalRank === body.rank)) throw new GameError('這個最終名次已登記給其他玩家');
    player.finalRank = body.rank;
    data = {...data, playerId:player.id, rank:body.rank};
  } else throw new GameError('不支援的主持人操作');
  state.revision++; state.version++;
  state.commands.push(body.commandId); state.commands = state.commands.slice(-32);
  return {kind:'host-command', at:now, data};
}
export function leaderboard(state) {
  let rank = 0;
  const sorted = [...state.players].sort((a,b) => b.score - a.score || a.name.localeCompare(b.name,'zh-Hant'));
  const counts = new Map(); sorted.forEach(p => counts.set(p.score, (counts.get(p.score) || 0) + 1));
  return sorted.map((p, i) => {
    if (i === 0 || p.score !== sorted[i-1].score) rank = i + 1;
    return {id:p.id, name:p.name, score:p.score, rank, tied:counts.get(p.score) > 1, finalRank:p.finalRank};
  });
}
export function snapshot(state, role = 'screen', player = null) {
  const q = currentQuestion(state);
  const revealed = ['revealed','finished'].includes(state.phase);
  return {
    version:state.version, revision:state.revision, phase:state.phase, points:POINTS,
    roundCount:ROUNDS.length, questionCount:QUESTIONS.length, position:state.index+1,
    question:state.phase === 'waiting' ? null : {
      id:q.id, text:q.text, options:q.options, round:q.round, number:q.number, roundName:q.roundName,
      ...(revealed ? {correct:q.correct} : {})
    },
    ...(role !== 'player' ? {playerCount:state.players.length, answeredCount:Object.keys(state.answers).length} : {}),
    leaderboard:revealed ? leaderboard(state) : [],
    ...(player ? {me:{id:player.id, name:player.name, score:player.score, finalRank:player.finalRank, answer:state.answers[player.id] ?? null}} : {})
  };
}
