import QRCode from 'qrcode';
import { validRoom, type HostAction, type Snapshot } from '../../../packages/shared/src/protocol.ts';
import { RoomConnection, type ServerMessage } from './lib/connection.ts';
import { showAdmin, showHostSetup } from './admin.ts';
import { showResults } from './results.ts';
import { showRooms } from './rooms.ts';
import './style.css';

const app = document.querySelector<HTMLElement>('#app')!;
const header = document.createElement('header'); header.innerHTML = '<span class="tag">家庭日・多人版測試中</span><h1>全員出動！</h1>'; app.append(header);
const panel = document.createElement('section'); panel.className = 'card'; app.append(panel);
const status = document.createElement('p'); status.className = 'status'; status.setAttribute('role', 'status'); app.append(status);
const say = (text: string) => { status.textContent = text; };
const configuration = fetch('/api/config').then(async response => {
 const config = await response.json(); if (!response.ok) throw new Error(config.error);
 if (config.environment === 'staging') {
  const notice = document.createElement('p'); notice.className = 'staging-notice';
  notice.textContent = config.turnstileMode === 'test' ? 'HTTPS 測試環境 · 人機驗證為測試模式 · 請使用測試題與測試暱稱' : 'HTTPS 測試環境 · 正式人機驗證'; header.append(notice);
 }
 return config;
});
void configuration.catch(error => say((error as Error).message));
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', parent: HTMLElement = panel) {
 const el = document.createElement(tag); el.textContent = text; parent.append(el); return el;
}
function input(label: string, type = 'text') {
 const wrap = element('label', label); const el = element('input', '', wrap); el.type = type; return el;
}
async function api(path: string, data: unknown, key?: string) {
 const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(data) });
 const result = await response.json(); if (!response.ok) throw new Error(result.error ?? '操作失敗'); return result;
}
const params = new URLSearchParams(location.search);
const isHost = params.has('host'); let room = params.get('room') ?? '';
let connection: RoomConnection | undefined, snapshot: Snapshot | undefined, online = false, clockOffset = 0;
let pendingCommand: string | undefined;
type PendingAnswer = { protocol: 1; type: 'answer.submit'; requestId: string; questionId: string; option: number };
let pendingAnswer: PendingAnswer | undefined;
const pendingKey = () => `answer:${room}`;
function clearPending() { pendingAnswer = undefined; localStorage.removeItem(pendingKey()); }
const labels = { LOBBY: '等待開始', QUESTION_OPEN: '答題中', QUESTION_CLOSED: '答題時間結束，等待公布', REVEAL: '答案公布', ROUND_END: '本回合結束', FINISHED: '遊戲完成', CLOSED: '房間已關閉' };
let content: HTMLElement;
function controls() {
 panel.querySelectorAll<HTMLButtonElement>('button[data-game]').forEach(b => {
  const answered = snapshot?.self?.answer !== undefined || !!pendingAnswer;
  b.disabled = !online || !!pendingCommand || (b.dataset.game === 'answer' && (snapshot?.phase !== 'QUESTION_OPEN' || answered || (snapshot.deadline ?? 0) <= Date.now() + clockOffset));
 });
}
function command(action: HostAction, playerId?: string) {
 if (!snapshot || pendingCommand || !online) return;
 if (['end', 'closeRoom', 'removePlayer'].includes(action) && !confirm(action === 'removePlayer' ? '確定移除這位玩家並撤銷憑證？' : '確定執行？此操作無法復原。')) return;
 const commandId = crypto.randomUUID();
 if (connection?.send({ protocol: 1, type: 'host.command', commandId, expectedVersion: snapshot.version, action, playerId })) pendingCommand = commandId;
 controls();
}
function action(label: string, kind: HostAction, parent: HTMLElement, playerId?: string) {
 const b = element('button', label, parent); b.dataset.game = 'command'; b.onclick = () => command(kind, playerId); return b;
}
function render(s: Snapshot) {
 content.replaceChildren();
 element('h2', labels[s.phase], content);
 element('p', `目前 ${s.online} 人在線／${s.joined} 人已加入`, content).id = 'count';
 if (!isHost && s.self) element('p', `${s.self.nickname}｜已公布分數：${s.self.score} 分`, content).id = 'name';
 if (s.question) {
  element('p', `第${s.question.round}回合 · 第${s.questionIndex + 1}/${s.questionCount}題`, content).className = 'muted';
  element('h3', s.question.text, content);
  if (s.phase === 'QUESTION_OPEN') element('p', '', content).id = 'countdown';
  const answers = element('div', '', content); answers.className = 'answers';
  s.question.options.forEach((option, i) => {
   const text = `${String.fromCharCode(65 + i)}　${option}`;
   if (!isHost && s.phase === 'QUESTION_OPEN') {
    const b = element('button', text, answers); b.dataset.game = 'answer'; b.className = 'answer';
    if (s.self?.answer === i || pendingAnswer?.option === i) b.classList.add('selected');
    b.onclick = () => {
     if (!online || s.self?.answer !== undefined || pendingAnswer) return;
     pendingAnswer = { protocol: 1, type: 'answer.submit', questionId: s.question!.id, option: i, requestId: crypto.randomUUID() };
     localStorage.setItem(pendingKey(), JSON.stringify(pendingAnswer));
     connection?.send(pendingAnswer); say('答案送出中，等待伺服器確認…'); controls();
    };
   } else {
    const row = element('p', text, answers); row.className = 'option';
    if (s.question!.correct === i) { row.classList.add('correct'); row.textContent += '（正確答案）'; }
    if (s.self?.answer === i) row.textContent += '（你的答案）';
   }
  });
  if (!isHost && s.self?.answer !== undefined) element('p', s.self.earned !== undefined ? `這題獲得 ${s.self.earned} 分` : '伺服器已收到你的答案', content);
 }
 if (isHost) {
  const actions = element('div', '', content); actions.className = 'actions';
  if (s.archive) {
   element('p', s.archive.status === 'complete' ? '成績已完整歸檔至 D1。' : `成績等待歸檔（已寫入${s.archive.cursor}／${s.archive.playerCount}人，失敗${s.archive.attempts}次）；關閉房間仍會自動重試。`, content);
   const archiveLink = element('a', '開啟成績後台', content); archiveLink.href = '?results';
  }
  if (s.phase === 'LOBBY') action('開始第一回合', 'start', actions);
  if (s.phase === 'ROUND_END') action('開始下一回合', 'start', actions);
  if (s.phase === 'QUESTION_OPEN') action('提前收題', 'close', actions);
  if (s.phase === 'QUESTION_CLOSED') action('公布答案與分數', 'reveal', actions);
  if (s.phase === 'REVEAL') action('下一題／回合結算', 'next', actions);
  if (!['FINISHED', 'CLOSED'].includes(s.phase)) action('提前結束遊戲', 'end', actions).className = 'secondary';
  if (s.phase !== 'CLOSED') action('關閉房間並撤銷所有憑證', 'closeRoom', actions).className = 'danger';
  if (s.phase === 'LOBBY') {
   const list = element('ul', '', content); list.id = 'players';
   for (const p of s.players ?? []) {
    const row = element('li', p.nickname, list); action('移除', 'removePlayer', row, p.id).className = 'small secondary';
   }
  }
 }
 if (s.leaderboard.length && s.phase !== 'LOBBY') {
  element('h3', '已公布累計排行榜（前10名）', content);
  const list = element('ol', '', content); list.className = 'rankings';
  for (const p of s.leaderboard) element('li', `第${p.rank}名　${p.nickname}　${p.score}分`, list);
 }
 if (s.phase === 'FINISHED') element('p', '同分並列；未答或答錯不扣分。', content).className = 'muted';
 controls(); tick();
}
function tick() {
 const el = document.querySelector('#countdown');
 if (el && snapshot?.deadline) el.textContent = `剩餘 ${Math.max(0, Math.ceil((snapshot.deadline - Date.now() - clockOffset) / 1000))} 秒`;
 controls();
}
setInterval(tick, 200);
function receive(msg: ServerMessage) {
 if (msg.type === 'state.snapshot') {
  const s = msg as unknown as Snapshot;
  if (snapshot && s.version < snapshot.version) return;
  snapshot = s; clockOffset = s.serverTime - Date.now();
  if (pendingAnswer) {
   if (s.question?.id !== pendingAnswer.questionId || s.self?.answer !== undefined) clearPending();
   else if (online) connection?.send(pendingAnswer);
  }
  render(s);
 } else if (msg.type === 'answer.ack') {
  if (pendingAnswer?.requestId === msg.requestId) clearPending();
  if (snapshot?.self && snapshot.question?.id === msg.questionId) { snapshot.self.answer = msg.option as number; render(snapshot); }
  say('伺服器已收到你的答案。');
 } else if (msg.type === 'command.ack') {
  if (pendingCommand === msg.commandId) pendingCommand = undefined; controls();
 } else if (msg.type === 'error') {
  if (pendingAnswer?.requestId === msg.requestId) clearPending();
  if (pendingCommand === msg.commandId) pendingCommand = undefined;
  say(String(msg.error)); controls();
 }
}
function enter(token: string) {
 panel.replaceChildren(); snapshot = undefined;
 element('p', `房間代碼：${room}`);
 if (isHost) {
  const roomsLink = element('a', '開啟房間狀態後台'); roomsLink.href = '?rooms'; roomsLink.target = '_blank'; roomsLink.rel = 'noopener';
  const join = new URL(location.href); join.search = ''; join.searchParams.set('room', room);
  const canvas = element('canvas'); QRCode.toCanvas(canvas, join.href, { width: 200 }).catch(() => say('QR Code產生失敗，請使用加入連結。'));
  const link = element('a', '開啟玩家加入頁'); link.href = join.href;
  const copy = element('button', '複製加入連結'); copy.onclick = () => navigator.clipboard.writeText(join.href).then(() => say('加入連結已複製')).catch(() => say(join.href));
 } else {
  try { const raw = localStorage.getItem(pendingKey()); if (raw) pendingAnswer = JSON.parse(raw); } catch { clearPending(); }
 }
 content = element('div'); element('p', '讀取房間狀態中…', content);
 connection = new RoomConnection(room, token, receive, (connected, text) => {
  online = connected; if (!connected) pendingCommand = undefined; say(text); controls();
  if (!snapshot) content.textContent = text;
 });
 connection.open();
}
async function showJoin() {
 element('h2', '一起玩，一起拿分。'); const code = input('房間代碼'); code.value = room; code.maxLength = 8;
 const name = input('你的暱稱（最多10個字）'); name.setAttribute('autocomplete', 'nickname');
 const join = element('button', '加入遊戲'); const host = element('a', '主持人入口'); host.href = '?host';
 let challenge: string | undefined;
 let resetChallenge: (() => void) | undefined;
 try {
  const config = await configuration;
  if (config.turnstileSiteKey) {
   join.disabled = true;
   const box = element('div'); box.id = 'challenge';
   const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
   script.onload = () => {
    const t = (window as unknown as { turnstile: { render(el: HTMLElement, config: Record<string, unknown>): string; reset(id: string): void } }).turnstile;
    const id = t.render(box, { sitekey: config.turnstileSiteKey, action: 'join', callback: (value: string) => { challenge = value; join.disabled = false; },
      'expired-callback': () => { challenge = undefined; join.disabled = true; }, 'error-callback': () => { challenge = undefined; join.disabled = true; say('人機驗證失敗，請重新整理。'); } });
    resetChallenge = () => { challenge = undefined; join.disabled = true; t.reset(id); };
   };
   script.onerror = () => say('人機驗證無法載入，請確認網路。'); document.head.append(script);
  }
 } catch (e) { join.disabled = true; say((e as Error).message); }
 join.onclick = async () => {
  room = code.value.trim().toUpperCase(); if (!validRoom(room)) { say('請輸入8碼房間代碼'); return; }
  join.disabled = true;
  try {
   const data = await api(`/api/rooms/${room}/join`, { nickname: name.value, challenge });
   localStorage.setItem(`player:${room}`, data.playerToken); history.replaceState(null, '', `?room=${room}`); enter(data.playerToken);
  } catch (e) { say((e as Error).message); if (resetChallenge) resetChallenge(); else join.disabled = false; }
 };
}
if (params.has('rooms')) {
 showRooms(panel, say);
} else if (params.has('results')) {
 showResults(panel, say);
} else if (params.has('admin')) {
 showAdmin(panel, say);
} else if (isHost) {
 const saved = validRoom(room) ? sessionStorage.getItem(`host:${room}`) : null;
 if (saved) enter(saved);
 else {
  showHostSetup(panel, say, data => {
   room = data.roomId; sessionStorage.setItem(`host:${room}`, data.hostToken);
   history.replaceState(null, '', `?host&room=${room}`); enter(data.hostToken);
  });
 }
} else {
 const saved = validRoom(room) ? localStorage.getItem(`player:${room}`) : null;
 if (saved) enter(saved); else void showJoin();
}
window.addEventListener('pagehide', () => connection?.stop());
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
