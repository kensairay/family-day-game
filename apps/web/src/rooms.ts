import type { RoomList, RoomStatus } from '../../../packages/shared/src/rooms.ts';
import { phaseLabels, lifecycleLabels } from '../../../packages/shared/src/rooms.ts';
import { validRoom } from '../../../packages/shared/src/protocol.ts';
import { adminLogin, adminRequest, el, field } from './lib/admin-api.ts';
const time = (value: number | null) => value === null ? '尚未開始' : new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'medium' }).format(value);
export function showRooms(panel: HTMLElement, say: (text: string) => void) {
 document.querySelector('main')?.classList.add('admin-layout');
 el(panel, 'h2', '房間狀態後台');
 const navigation = el(panel, 'nav'); navigation.className = 'admin-nav'; navigation.setAttribute('aria-label', '後台導覽');
 for (const [label, href] of [['題庫後台','?admin'],['主持人入口','?host'],['活動成績歸檔','?results']]) el(navigation, 'a', label).href = href;
 const auth = el(panel, 'div'); const workspace = el(panel, 'div'); workspace.hidden = true;
 el(workspace, 'p', '清單列出尚未到期的已建立房間，包含已完成或已關閉的房間。已到期房間可用代碼查詢；按重新整理更新狀態。').className = 'muted';
 const code = field(workspace, '查詢房間代碼（8碼）', ''); code.maxLength = 8; code.autocomplete = 'off';
 const search = el(workspace, 'button', '查詢房間狀態'); search.className = 'secondary';
 const details = el(workspace, 'section'); details.className = 'room-detail'; details.setAttribute('aria-live', 'polite');
 const reload = el(workspace, 'button', '重新整理房間清單');
 const updated = el(workspace, 'p'); updated.className = 'muted';
 const list = el(workspace, 'div'); const pager = el(workspace, 'div'); pager.className = 'actions';
 let busy = false, selected: string | undefined;
 let cursor: string | undefined, previous: (string | undefined)[] = [];
 // Every request uses the existing adminRequest session epoch guard. A logout
 // clears both the UI and pending responses, including other tabs and expiry.
 adminLogin(auth, say, async () => { workspace.hidden = false; cursor = undefined; previous = []; await run(load); }, () => {
  workspace.hidden = true; list.replaceChildren(); details.replaceChildren(); pager.replaceChildren(); updated.textContent = ''; code.value = '';
  selected = undefined; cursor = undefined; previous = [];
 }, () => !busy);
 async function run(task: () => Promise<void>) {
  if (busy) return; busy = true; workspace.inert = true; workspace.setAttribute('aria-busy', 'true');
  try { await task(); } catch (error) { say((error as Error).message); }
  finally { busy = false; workspace.inert = false; workspace.removeAttribute('aria-busy'); }
 }
 const progress = (room: RoomStatus) => room.questionIndex < 0 ? `尚未開始，共${room.questionCount}題` : `第${room.round ?? '—'}回合 · 第${room.questionIndex + 1}／${room.questionCount}題`;
 function renderDetail(room: RoomStatus) {
  details.replaceChildren(); details.dataset.room = room.roomId;
  el(details, 'h3', `房間 ${room.roomId} 詳細狀態`);
  const data = el(details, 'dl'); data.className = 'room-facts';
  const facts: [string, string][] = [
   ['題庫',room.source.title], ['發布版本',String(room.source.revision ?? '本機／舊版')],
   ['房間狀態',lifecycleLabels[room.lifecycle]], ['遊戲階段',phaseLabels[room.phase]],
   ['玩家人數',`${room.online} 人在線／${room.joined} 人已加入`], ['主持人連線',room.hostOnline ? '在線' : '離線'],
   ['題目進度',progress(room)], ['已公布題數',`${room.revealedCount}／${room.questionCount}題`],
   ['建立時間',time(room.createdAt)], ['開始時間',time(room.startedAt)], ['到期時間',time(room.expires)],
   ['作答截止',room.deadline === null ? '無' : time(room.deadline)], ['最後更新',time(room.checkedAt)],
   ['成績歸檔',room.archive ? room.archive.status === 'complete' ? '已完整歸檔' : `等待歸檔：${room.archive.cursor}／${room.archive.playerCount}人` : '尚未結算'],
  ];
  for (const [label,value] of facts) { el(data,'dt',label); el(data,'dd',value); }
  const refresh = el(details, 'button', '重新整理此房間'); refresh.className = 'secondary';
  refresh.onclick = () => run(() => view(room.roomId));
  if (room.lifecycle === 'open' && room.phase === 'LOBBY') {
   el(details, 'a', '開啟玩家加入頁').href = `?room=${room.roomId}`;
  }
  const archive = el(details, 'a', '查看活動成績歸檔'); archive.href = '?results';
 }
 async function view(roomId: string) {
  // Remove stale room facts before a failed lookup can leave the wrong room
  // looking current; credentials and game controls are never rendered here.
  details.replaceChildren(); details.removeAttribute('data-room'); selected = undefined;
  const room = await adminRequest<RoomStatus>(`/api/admin/rooms/${roomId}`);
  selected = roomId; code.value = roomId; renderDetail(room); say('房間狀態已更新。');
 }
 async function load() {
  const result = await adminRequest<RoomList>('/api/admin/rooms' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''));
  list.replaceChildren(); pager.replaceChildren(); updated.textContent = `清單更新：${time(result.checkedAt)}（台北時間）`;
  if (!result.rooms.length) el(list,'p','目前沒有尚未到期的房間。');
  for (const entry of result.rooms) {
   const row = el(list,'section'); row.className = 'room-row'; row.dataset.room = entry.roomId;
   el(row,'h3',`房間 ${entry.roomId}`);
   if (entry.status) {
    const room = entry.status;
    el(row,'p',room.source.title);
    el(row,'p',`${lifecycleLabels[room.lifecycle]}｜${phaseLabels[room.phase]}｜主持人${room.hostOnline ? '在線' : '離線'}`);
    el(row,'p',`${room.online} 人在線／${room.joined} 人已加入｜${progress(room)}`);
    el(row,'p',`建立：${time(room.createdAt)}；到期：${time(room.expires)}（台北）`).className = 'muted';
   } else el(row,'p','房間狀態暫時無法讀取，請稍後重新整理。');
   const viewButton = el(row,'button','查看房間狀態'); viewButton.className = 'small secondary'; viewButton.onclick = () => run(() => view(entry.roomId));
  }
  if (previous.length) {
   const back = el(pager,'button','上一頁'); back.className = 'secondary';
   back.onclick = () => run(async () => { cursor = previous.pop(); await load(); });
  }
  if (result.nextCursor) {
   const next = el(pager,'button','下一頁'); next.className = 'secondary';
   next.onclick = () => run(async () => { previous.push(cursor); cursor = result.nextCursor!; await load(); });
  }
 }
 search.onclick = () => run(async () => {
  const roomId = code.value.trim().toUpperCase();
  if (!validRoom(roomId)) { details.replaceChildren(); selected = undefined; throw new Error('請輸入8碼房間代碼'); }
  await view(roomId);
 });
 reload.onclick = () => run(async () => { cursor = undefined; previous = []; await load(); if (selected) await view(selected); say('房間清單已更新。'); });
}
