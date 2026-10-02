import type { HostAction, Phase, Player, Question, Standing } from '../../../../packages/shared/src/protocol.ts';
export interface GameState { phase: Phase; index: number; revealedThrough: number; deadline: number | null; version: number }
export const initialState = (): GameState => ({ phase: 'LOBBY', index: -1, revealedThrough: -1, deadline: null, version: 0 });
export const sampleQuestions: Question[] = [
 { id: 'demo-1', round: 1, text: '一小時有幾分鐘？', options: ['30分鐘', '60分鐘', '90分鐘'], correct: 1, seconds: 15, points: 260 },
 { id: 'demo-2', round: 2, text: '太陽從哪個方向升起？', options: ['東方', '西方', '北方'], correct: 0, seconds: 15, points: 260 },
 { id: 'demo-3', round: 3, text: '三角形有幾條邊？', options: ['2條', '3條', '4條'], correct: 1, seconds: 15, points: 260 },
];
export function validateQuestions(value: unknown): Question[] {
 if (!Array.isArray(value) || value.length < 1 || value.length > 60) throw new Error('題庫須有1～60題');
 let round = 1; const ids = new Set<string>();
 return value.map((raw, i) => {
  if (!raw || typeof raw !== 'object') throw new Error('題目格式錯誤');
  const q = raw as Question;
  if (typeof q.id !== 'string' || !/^[\w-]{1,80}$/.test(q.id) || ids.has(q.id)) throw new Error('題目ID不可重複');
  ids.add(q.id);
  if (!Number.isInteger(q.round) || q.round < 1 || q.round > 3 || (i === 0 && q.round !== 1) || q.round < round || q.round > round + 1) throw new Error('回合必須從1開始依序編排');
  round = q.round;
  if (typeof q.text !== 'string' || !q.text.trim() || q.text.length > 300) throw new Error('題目須為1～300字');
  if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4 || q.options.some(o => typeof o !== 'string' || !o.trim() || o.length > 100)) throw new Error('每題須有2～4個有效選項');
  if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.options.length) throw new Error('請指定有效的正確答案');
  if (!Number.isInteger(q.seconds) || q.seconds < 3 || q.seconds > 120) throw new Error('答題時間須為3～120秒');
  if (!Number.isInteger(q.points) || q.points < 0 || q.points > 10000) throw new Error('配分須為0～10000');
  return { id: q.id, round: q.round, text: q.text.trim(), options: q.options.map(o => o.trim()), correct: q.correct, seconds: q.seconds, points: q.points };
 });
}
export function settleDeadline(state: GameState, now: number): GameState {
 return state.phase === 'QUESTION_OPEN' && state.deadline !== null && now >= state.deadline
  ? { ...state, phase: 'QUESTION_CLOSED', version: state.version + 1 } : state;
}
export function transition(state: GameState, action: HostAction, questions: Question[], now: number): GameState {
 if (state.phase === 'CLOSED') throw new Error('房間已關閉');
 const next = { ...state, version: state.version + 1 };
 const open = (index: number): GameState => ({ ...next, index, phase: 'QUESTION_OPEN', deadline: now + questions[index].seconds * 1000 });
 if (action === 'closeRoom') return { ...next, phase: 'CLOSED', deadline: null };
 if (action === 'end') return { ...next, phase: 'FINISHED', deadline: null, revealedThrough: state.index };
 if (action === 'start' && state.phase === 'LOBBY') return open(0);
 if (action === 'start' && state.phase === 'ROUND_END') return open(state.index + 1);
 if (action === 'close' && state.phase === 'QUESTION_OPEN') return { ...next, phase: 'QUESTION_CLOSED', deadline: now };
 if (action === 'reveal' && state.phase === 'QUESTION_CLOSED') return { ...next, phase: 'REVEAL', revealedThrough: state.index };
 if (action === 'next' && state.phase === 'REVEAL') {
  if (state.index + 1 === questions.length) return { ...next, phase: 'FINISHED', deadline: null };
  if (questions[state.index + 1].round !== questions[state.index].round) return { ...next, phase: 'ROUND_END', deadline: null };
  return open(state.index + 1);
 }
 throw new Error('此階段無法執行這個操作');
}
export function canAnswer(state: GameState, questionId: unknown, option: unknown, questions: Question[], now: number): boolean {
 const q = questions[state.index];
 return state.phase === 'QUESTION_OPEN' && state.deadline !== null && now < state.deadline && !!q && q.id === questionId && Number.isInteger(option) && (option as number) >= 0 && (option as number) < q.options.length;
}
export function standings(players: Player[]): Standing[] {
 const sorted = [...players].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)); let rank = 0;
 return sorted.map((p, i) => { if (i === 0 || p.score !== sorted[i - 1].score) rank = i + 1; return { ...p, rank }; });
}
